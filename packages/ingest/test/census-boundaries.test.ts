import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import type { MultiPolygon, Polygon } from 'geojson';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCensusBoundariesAdapter } from '../src/adapters/census-boundaries';
import {
  buildStateShapes,
  DEFAULT_MAP_OPTIONS,
  formatTenths,
  geographicExtent,
  projectionFor,
  toPathData,
  windForD3,
} from '../src/adapters/census-boundaries/geometry';
import { loadBoundaries } from '../src/adapters/census-boundaries/load';
import {
  asOfFromMetadata,
  buildBoundaryRecords,
  DISTRICT_BASE,
  STATE_BASE,
  UNMAPPED_TERRITORIES,
  vintageLabel,
} from '../src/adapters/census-boundaries/parse';
import {
  countShpRecords,
  MAX_BOUNDARY_ENTRY_BYTES,
  readBoundaryZip,
} from '../src/adapters/census-boundaries/read';
import type { HttpDeps } from '../src/runtime/http';
import { silentLogger } from '../src/runtime/logger';
import { runIngest } from '../src/runtime/run';
import { MANIFEST_FILE } from '../src/runtime/snapshot';
import { FIXTURES, freshDb, rows, SCOPES, testRuntime } from './helpers';
import {
  dbfBuffer,
  FIXTURE_DISTRICT_ZIP,
  FIXTURE_METADATA,
  FIXTURE_STATE_ZIP,
  FIXTURE_STATES,
  fixtureZips,
  shpBuffer,
  zipEntries,
} from './support/census-fixture';

const FIXTURE_DIR = join(FIXTURES, 'census-boundaries');
const TINY = { districts: 1, states: 1 };
const META = {
  vintage: vintageLabel(2025, 119),
  asOf: '2024-05-31',
  districtFile: 'cb_2025_us_cd119_500k',
  stateFile: 'cb_2025_us_state_500k',
};

async function fixtureRecords() {
  const districts = await readBoundaryZip(FIXTURE_DIR, FIXTURE_DISTRICT_ZIP, DISTRICT_BASE);
  const states = await readBoundaryZip(FIXTURE_DIR, FIXTURE_STATE_ZIP, STATE_BASE);
  return { districts, states };
}

/** Parses the path data back to absolute points in tenths of a pixel, one array per ring. */
function ringsOf(path: string): Array<Array<[number, number]>> {
  return path
    .split('Z')
    .filter(Boolean)
    .map((subpath) => {
      expect(subpath).toMatch(/^M[-\d. ]+l[-\d. ]+$/);
      const [head, rest] = subpath.slice(1).split('l') as [string, string];
      const numbers = (s: string) =>
        (s.match(/-?\d*\.?\d+/g) ?? []).map((n) => Math.round(Number(n) * 10));
      const [x0, y0] = numbers(head) as [number, number];
      const deltas = numbers(rest);
      expect(deltas.length % 2).toBe(0);
      const points: Array<[number, number]> = [[x0, y0]];
      for (let i = 0; i < deltas.length; i += 2) {
        const last = points[points.length - 1] as [number, number];
        points.push([last[0] + (deltas[i] as number), last[1] + (deltas[i + 1] as number)]);
      }
      return points;
    });
}

describe('path formatting', () => {
  it('writes tenths of a pixel as the shortest SVG number', () => {
    expect([0, 5, -5, 12, -12, 100, -100, 101, 3405].map(formatTenths)).toEqual([
      '0',
      '.5',
      '-.5',
      '1.2',
      '-1.2',
      '10',
      '-10',
      '10.1',
      '340.5',
    ]);
  });

  it('round-trips ring points to the nearest tenth and closes each ring', () => {
    const ring: Array<[number, number]> = [
      [1.04, 2.26],
      [10.5, 2.26],
      [10.5, -0.04 + 9],
      [1.04, 9.14],
      [1.04, 2.26],
    ];
    const path = toPathData([[ring]]);
    expect(path.endsWith('Z')).toBe(true);
    const [points] = ringsOf(path) as [Array<[number, number]>];
    expect(points).toEqual([
      [10, 23],
      [105, 23],
      [105, 90],
      [10, 91],
    ]);
  });

  it('drops zero-length segments and rings that collapse below a triangle', () => {
    expect(
      toPathData([
        [
          [
            [0, 0],
            [0.01, 0.01],
            [0.02, 0],
            [0, 0],
          ],
        ],
      ]),
    ).toBe('');
  });
});

describe('Census shapefile reading', () => {
  it('reads features, properties and the metadata sidecar from the zips', async () => {
    const { districts, states } = await fixtureRecords();
    expect(districts.name).toBe('cb_2025_us_cd119_500k');
    expect(districts.features).toHaveLength(9);
    expect(districts.features[0]?.properties).toMatchObject({
      STATEFP: '90',
      CD119FP: '01',
      GEOID: '9001',
      CDSESSN: '119',
    });
    expect(districts.metadata).toContain('by May 31, 2024');
    expect(states.features.map((f) => f.properties.STUSPS)).toEqual([
      'ZA',
      'ZB',
      'ZC',
      'ZD',
      'ZE',
      'AS',
    ]);
    expect(states.metadata).toBeNull();
    // The hole of ZA's lake and the speck island survive reading as separate rings/polygons.
    const za = states.features[0]?.geometry as MultiPolygon;
    expect(za.type).toBe('MultiPolygon');
    expect(za.coordinates).toHaveLength(2);
    expect(za.coordinates[0]).toHaveLength(2);
  });

  it('committed fixture zips are exactly what the generator writes (no drift)', async () => {
    for (const [name, bytes] of Object.entries(fixtureZips())) {
      expect(Buffer.compare(await readFile(join(FIXTURE_DIR, name)), bytes), name).toBe(0);
    }
  });

  it('refuses an archive over the decompression cap and one without the shapefile pair', async () => {
    await expect(
      readBoundaryZip(FIXTURE_DIR, FIXTURE_STATE_ZIP, STATE_BASE, { maxBytes: 100 }),
    ).rejects.toThrow(/exceeds the 100-byte decompression cap/);
    const dir = await mkdtemp(join(tmpdir(), 'civic-cb-'));
    await writeFile(
      join(dir, 'bare.zip'),
      zipEntries([{ name: 'readme.txt', content: Buffer.from('x') }]),
    );
    await expect(readBoundaryZip(dir, 'bare.zip', STATE_BASE)).rejects.toThrow(
      /has no cb_2025_us_state_500k.shp and/,
    );
  });
});

describe('archive layout is strict', () => {
  const base = STATE_BASE;
  const pair = (features = FIXTURE_STATES) => [
    { name: `${base}.shp`, content: shpBuffer(features) },
    { name: `${base}.dbf`, content: dbfBuffer(features) },
  ];
  async function readZip(entries: Array<{ name: string; content: Buffer }>, expected = base) {
    const dir = await mkdtemp(join(tmpdir(), 'civic-cb-layout-'));
    await writeFile(join(dir, 'x.zip'), zipEntries(entries));
    return readBoundaryZip(dir, 'x.zip', expected);
  }

  it('reads exactly one .shp and one .dbf with the expected base name at the root', async () => {
    const file = await readZip(pair());
    expect(file.features).toHaveLength(FIXTURE_STATES.length);
    expect(file.metadata).toBeNull();
  });

  it('rejects a second .shp, a duplicate entry, a folder, or another base name', async () => {
    await expect(
      readZip([...pair(), { name: 'other.shp', content: shpBuffer(FIXTURE_STATES) }]),
    ).rejects.toThrow(/unexpected entry "other.shp"/);
    await expect(
      readZip([...pair(), { name: `sub/${base}.shp`, content: shpBuffer(FIXTURE_STATES) }]),
    ).rejects.toThrow(/unexpected entry "sub\/cb_2025_us_state_500k.shp"/);
    await expect(readZip([...pair(), ...pair()])).rejects.toThrow(/duplicate entry/);
    await expect(readZip(pair(), 'cb_2025_us_cd119_500k')).rejects.toThrow(/unexpected entry/);
    await expect(
      readZip([{ name: `${base}.dbf`, content: dbfBuffer(FIXTURE_STATES) }]),
    ).rejects.toThrow(/has no cb_2025_us_state_500k\.shp and/);
  });

  it('rejects a .dbf whose record count differs from the .shp', async () => {
    await expect(
      readZip([
        { name: `${base}.shp`, content: shpBuffer(FIXTURE_STATES) },
        { name: `${base}.dbf`, content: dbfBuffer(FIXTURE_STATES.slice(1)) },
      ]),
    ).rejects.toThrow(/the \.shp has 6 records but the \.dbf has 5/);
  });

  it('rejects a truncated .shp, and a feature without geometry, naming it', async () => {
    const shp = shpBuffer(FIXTURE_STATES);
    expect(() => countShpRecords(shp.subarray(0, shp.length - 5), 'x.zip')).toThrow(/truncated/);
    // Append a "null shape" record (type 0) and a matching .dbf row.
    const nullRecord = Buffer.alloc(12);
    nullRecord.writeInt32BE(FIXTURE_STATES.length + 1, 0);
    nullRecord.writeInt32BE(2, 4);
    const withNull = Buffer.concat([shp, nullRecord]);
    withNull.writeInt32BE(withNull.length / 2, 24);
    const dbf = dbfBuffer([
      ...FIXTURE_STATES,
      FIXTURE_STATES[0] as (typeof FIXTURE_STATES)[number],
    ]);
    await expect(
      readZip([
        { name: `${base}.shp`, content: withNull },
        { name: `${base}.dbf`, content: dbf },
      ]),
    ).rejects.toThrow(/feature 7 \(90\) has no geometry/);
  });

  it('applies a 64 MiB per-entry cap that is lower than the generic one', async () => {
    expect(MAX_BOUNDARY_ENTRY_BYTES).toBe(64 * 1024 * 1024);
    const dir = await mkdtemp(join(tmpdir(), 'civic-cb-cap-'));
    await writeFile(join(dir, 'x.zip'), zipEntries(pair()));
    await expect(
      readBoundaryZip(dir, 'x.zip', base, { maxBytes: 2 * 1024 ** 3 }),
    ).resolves.toBeDefined();
    await expect(readBoundaryZip(dir, 'x.zip', base, { maxBytes: 50 })).rejects.toThrow(/50-byte/);
  });
});

describe('as-of date and vintage', () => {
  it('reads the date the states provided district lines from the Census abstract', () => {
    expect(asOfFromMetadata(FIXTURE_METADATA)).toBe('2024-05-31');
    expect(
      asOfFromMetadata('... provided to the Census Bureau by the states by January 3, 2025.'),
    ).toBe('2025-01-03');
  });

  it('fails loudly instead of guessing when the sentence is missing', () => {
    expect(() => asOfFromMetadata(null)).toThrow(/as-of date cannot be set/);
    expect(() => asOfFromMetadata('The 2026 files were provided in spring.')).toThrow(
      /as-of date cannot be set/,
    );
  });

  it('labels the vintage with the year and the Congress', () => {
    expect(vintageLabel(2025, 119)).toBe('2025 cartographic boundary files, 119th Congress');
    expect(vintageLabel(2027, 120)).toBe('2027 cartographic boundary files, 120th Congress');
    expect(vintageLabel(2029, 121)).toBe('2029 cartographic boundary files, 121st Congress');
  });
});

describe('projection and simplification', () => {
  it('keeps every path inside its viewBox with finite numbers, for every fixture state', async () => {
    const { districts, states } = await fixtureRecords();
    const records = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      undefined,
      TINY,
    );
    expect(records.map((r) => r.state)).toEqual(['ZA', 'ZB', 'ZC', 'ZD', 'ZE']);
    for (const r of records) {
      expect(r.width).toBeGreaterThan(0);
      expect(r.width).toBeLessThanOrEqual(DEFAULT_MAP_OPTIONS.maxWidth);
      expect(r.height).toBeGreaterThan(0);
      expect(r.height).toBeLessThanOrEqual(DEFAULT_MAP_OPTIONS.maxHeight);
      for (const path of [r.statePath, ...r.districts.map((d) => d.path)]) {
        expect(path).not.toMatch(/NaN|Infinity/);
        for (const ring of ringsOf(path)) {
          expect(ring.length).toBeGreaterThanOrEqual(3);
          for (const [x, y] of ring) {
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(r.width * 10);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(r.height * 10);
          }
        }
      }
      // The outline fills the box: the longer side reaches the padding on both ends.
      const all = ringsOf(r.statePath).flat();
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      const pad = DEFAULT_MAP_OPTIONS.padding * 10;
      expect(Math.min(...xs)).toBeLessThanOrEqual(pad + 1);
      expect(Math.min(...ys)).toBeLessThanOrEqual(pad + 1);
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(r.width * 10 - pad - 11);
    }
  });

  it('simplifies a densely sampled outline to a small fraction of its vertices', () => {
    // A 4,000-vertex wobbly circle (noise far below a pixel) is a few dozen vertices after.
    const ring = Array.from({ length: 4001 }, (_, i) => {
      const angle = (i % 4000) * ((2 * Math.PI) / 4000);
      const r = 1 + 0.00002 * Math.sin(i * 7.1);
      // Clockwise, as shapefile exteriors are.
      return [10 + r * Math.cos(-angle), 40 + r * Math.sin(-angle)];
    });
    const shapes = buildStateShapes({
      state: { type: 'Polygon', coordinates: [ring] },
      districts: [],
    });
    expect(shapes.stats.verticesIn).toBe(4001);
    expect(shapes.stats.verticesOut).toBeLessThan(120);
    expect(shapes.statePath.length).toBeLessThan(900);
  });

  it('keeps a simplified outline within a pixel of the unsimplified one', async () => {
    const { districts, states } = await fixtureRecords();
    const [za] = buildBoundaryRecords(districts.features, states.features, META, undefined, TINY);
    expect(za?.state).toBe('ZA');
    expect(za?.stats.verticesOut).toBeLessThan((za?.stats.verticesIn ?? 0) * 0.75);
    const raw = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      { ...DEFAULT_MAP_OPTIONS, simplifyArea: 0, minRingArea: 0 },
      TINY,
    )[0];
    const reference = ringsOf(raw?.statePath ?? '').flat();
    for (const [x, y] of ringsOf(za?.statePath ?? '').flat()) {
      const nearest = Math.min(...reference.map(([rx, ry]) => Math.hypot(rx - x, ry - y)));
      expect(nearest / 10).toBeLessThan(1);
    }
  });

  it('drops a speck island and keeps lakes (holes) and the largest polygon', async () => {
    const { districts, states } = await fixtureRecords();
    const [za] = buildBoundaryRecords(districts.features, states.features, META, undefined, TINY);
    expect(za?.stats.ringsDropped).toBeGreaterThanOrEqual(2); // the speck, in outline and district 3
    // Outline: exterior + the lake; the speck polygon is gone.
    expect(ringsOf(za?.statePath ?? '')).toHaveLength(2);
    const d2 = za?.districts.find((d) => d.district === 2);
    expect(ringsOf(d2?.path ?? '')).toHaveLength(2);
    const d3 = za?.districts.find((d) => d.district === 3);
    expect(ringsOf(d3?.path ?? '')).toHaveLength(1);
  });

  it('keeps shared district borders shared after simplification (no gaps or overlaps)', async () => {
    const { districts, states } = await fixtureRecords();
    const [za] = buildBoundaryRecords(districts.features, states.features, META, undefined, TINY);
    const key = (p: [number, number]) => `${p[0]},${p[1]}`;
    const points = (district: number) =>
      new Set(
        ringsOf(za?.districts.find((d) => d.district === district)?.path ?? '')
          .flat()
          .map(key),
      );
    const shared = [...points(1)].filter((p) => points(2).has(p));
    expect(shared.length).toBeGreaterThan(5);
  });

  it('places an antimeridian state in one piece, not stretched across the world', async () => {
    const { districts, states } = await fixtureRecords();
    const zb = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      undefined,
      TINY,
    ).find((r) => r.state === 'ZB');
    // 23 degrees of longitude at ~55 N by 6 degrees of latitude: wide, not world-wide.
    expect((zb?.width ?? 0) / (zb?.height ?? 1)).toBeGreaterThan(1.5);
    expect(zb?.width).toBe(240);
    const rings = ringsOf(zb?.statePath ?? '');
    expect(rings).toHaveLength(2);
    // The two pieces meet along the antimeridian: both seam corners are shared vertices.
    const key = (p: [number, number]) => `${p[0]},${p[1]}`;
    const first = new Set((rings[0] ?? []).map(key));
    expect((rings[1] ?? []).filter((p) => first.has(key(p)))).toHaveLength(2);
    // The central meridian is on the antimeridian side of the box, between -180 and 180.
    const centre = geographicExtent(
      windForD3(states.features[1]?.geometry as Polygon | MultiPolygon),
    );
    expect(Math.abs(centre.centralLongitude)).toBeGreaterThan(165);
  });

  it('handles a high-latitude state (finite, filled box)', async () => {
    const { districts, states } = await fixtureRecords();
    const ze = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      undefined,
      TINY,
    ).find((r) => r.state === 'ZE');
    expect(ze?.districts.map((d) => d.district)).toEqual([1, 2]);
    expect(ze?.statePath).not.toMatch(/NaN/);
  });

  it('does not size the box to far-off specks (Hawaii and its northwestern islands)', () => {
    const square = (x: number, y: number, size: number) => [
      [x, y],
      [x, y + size],
      [x + size, y + size],
      [x + size, y],
      [x, y],
    ];
    const state: MultiPolygon = {
      type: 'MultiPolygon',
      // A 5-degree island and a 0.02-degree speck 35 degrees east of it.
      coordinates: [[square(0, 0, 5)], [square(40, 0, 0.02)]],
    };
    const shapes = buildStateShapes({ state, districts: [] });
    // Fitted to the island alone the box is square; fitted to both it would be ~8:1.
    expect(shapes.width / shapes.height).toBeGreaterThan(0.8);
    expect(shapes.width / shapes.height).toBeLessThan(1.25);
    expect(ringsOf(shapes.statePath)).toHaveLength(1);
  });

  it('winds a counter-clockwise ring so it is the small side, not the whole sphere', () => {
    const ccw: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    const fixed = windForD3(ccw);
    const { projection } = projectionFor(fixed, DEFAULT_MAP_OPTIONS);
    const [x, y] = projection([5, 5]) as [number, number];
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    const shapes = buildStateShapes({ state: ccw, districts: [] });
    expect(shapes.width).toBeLessThanOrEqual(240);
    expect(shapes.statePath.startsWith('M')).toBe(true);
  });
});

describe('at-large seats, delegates and unmapped territories', () => {
  it('gives at-large (00) and delegate (98) records no district shape of their own', async () => {
    const { districts, states } = await fixtureRecords();
    const records = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      undefined,
      TINY,
    );
    const byState = new Map(records.map((r) => [r.state, r]));
    for (const code of ['ZB', 'ZC', 'ZD']) {
      expect(byState.get(code)?.districts, code).toEqual([]);
      expect(byState.get(code)?.wholeStateDistricts, code).toBe(1);
      expect(byState.get(code)?.statePath.length, code).toBeGreaterThan(10);
    }
    expect(byState.get('ZA')?.wholeStateDistricts).toBe(0);
  });

  it('leaves American Samoa and the Northern Mariana Islands unmapped', async () => {
    expect(UNMAPPED_TERRITORIES).toEqual(['AS', 'MP']);
    const { districts, states } = await fixtureRecords();
    const records = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      undefined,
      TINY,
    );
    expect(records.some((r) => r.state === 'AS')).toBe(false);
  });

  it('rejects a district whose state is not in the state file, and a duplicate district number', async () => {
    const { districts, states } = await fixtureRecords();
    const orphan = {
      ...(districts.features[0] as (typeof districts.features)[number]),
      properties: { ...districts.features[0]?.properties, STATEFP: '77', GEOID: '7701' },
    };
    expect(() =>
      buildBoundaryRecords([...districts.features, orphan], states.features, META, undefined, TINY),
    ).toThrow(/district 7701 has STATEFP 77, which is not in cb_2025_us_state_500k/);
    expect(() =>
      buildBoundaryRecords(
        [...districts.features, districts.features[0] as (typeof districts.features)[number]],
        states.features,
        META,
        undefined,
        TINY,
      ),
    ).toThrow(/duplicate district 9001/);
  });

  it('refuses to store path data that is not plain drawing commands', async () => {
    const { districts, states } = await fixtureRecords();
    const [record] = buildBoundaryRecords(
      districts.features,
      states.features,
      META,
      undefined,
      TINY,
    );
    const hostile = {
      ...(record as NonNullable<typeof record>),
      statePath: 'M0 0l1 1" onload="x Z',
    };
    async function* one() {
      yield hostile;
    }
    const handle = await freshDb();
    try {
      await expect(
        loadBoundaries(one(), {
          db: handle.db,
          sourceId: 'census-boundaries',
          ingestRunId: 1,
          retrievedAt: new Date(),
          scope: { kind: 'all' },
          logger: silentLogger,
        }),
      ).rejects.toThrow(/ZA outline: generated path data is not plain drawing commands/);
    } finally {
      await handle.close();
    }
  });

  it('rejects files that look cut off, and districts from another Congress', async () => {
    const { districts, states } = await fixtureRecords();
    expect(() => [...buildBoundaryRecords(districts.features, states.features, META)]).toThrow(
      /look truncated: 9 districts \(expected 441\) and 6 states \(expected 56\)/,
    );
    const other = districts.features.map((f) => ({
      ...f,
      properties: { ...f.properties, CDSESSN: '118' },
    }));
    expect(() => buildBoundaryRecords(other, states.features, META, undefined, TINY)).toThrow(
      /is for Congress 118, expected 119/,
    );
  });
});

describe('ingest.run for census-boundaries (fixture zips, PGlite)', () => {
  let handle: DbHandle;
  beforeEach(async () => {
    handle = await freshDb();
  });
  afterEach(() => handle.close());
  const adapters = { 'census-boundaries': createCensusBoundariesAdapter(TINY) };
  const run = async (overrides = {}, snapshotPath: string | undefined = FIXTURE_DIR) =>
    runIngest(
      {
        source: 'census-boundaries',
        scope: SCOPES['census-boundaries'],
        ...(snapshotPath ? { snapshotPath } : {}),
      },
      await testRuntime(handle, { adapters, ...overrides }),
    );

  it('loads one outline per state and one row per numbered district, with provenance', async () => {
    const receipt = await run();
    expect(receipt).toMatchObject({ status: 'succeeded', deduplicated: false, error: null });
    expect(receipt.counts).toMatchObject({
      shapes: 10,
      states: 5,
      districts: 5,
      whole_state_districts: 3,
      stale_shapes_deleted: 0,
    });
    expect(receipt.counts.vertices_out).toBeLessThan(receipt.counts.vertices_in ?? 0);
    const table = await rows<{
      state: string;
      district: number | null;
      vintage: string;
      publisher: string;
      as_of: string;
      congress: number;
      source_id: string;
      source_key: string;
      ingest_run_id: number;
    }>(
      handle.db,
      sql`select state, district, congress, vintage, publisher, as_of::text, source_id, source_key, ingest_run_id from district_map order by state, district nulls first`,
    );
    expect(table.map((r) => `${r.state}:${r.district ?? 'state'}`)).toEqual([
      'ZA:state',
      'ZA:1',
      'ZA:2',
      'ZA:3',
      'ZB:state',
      'ZC:state',
      'ZD:state',
      'ZE:state',
      'ZE:1',
      'ZE:2',
    ]);
    expect(table[0]).toMatchObject({
      vintage: '2025 cartographic boundary files, 119th Congress',
      publisher: 'U.S. Census Bureau',
      as_of: '2024-05-31',
      congress: 119,
      source_id: 'census-boundaries',
      source_key: 'cb_2025_us_state_500k:90',
      ingest_run_id: receipt.runId,
    });
    expect(table[2]?.source_key).toBe('cb_2025_us_cd119_500k:9002');
  });

  it('serves the loaded shapes through districts.shape@1', async () => {
    await run();
    const district = await dispatch(
      'districts.shape',
      { state: 'ZA', district: 2 },
      { db: handle.db },
    );
    expect(district).toMatchObject({
      scope: 'district',
      stateName: 'Zalia',
      description: 'Map of Zalia with congressional district 2 highlighted',
      vintage: '2025 cartographic boundary files, 119th Congress',
      publisher: 'U.S. Census Bureau',
      asOf: '2024-05-31',
      provenance: { sourceId: 'census-boundaries', sourceKey: 'cb_2025_us_cd119_500k:9002' },
    });
    const atLarge = await dispatch(
      'districts.shape',
      { state: 'ZC', district: 0 },
      { db: handle.db },
    );
    expect(atLarge).toMatchObject({ scope: 'state', districtPath: null });
    await expect(
      dispatch('districts.shape', { state: 'AS' }, { db: handle.db }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is deduplicated on a rerun and writes nothing twice', async () => {
    const first = await run();
    const again = await run();
    expect(again).toEqual({ ...first, deduplicated: true });
    const [count] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from district_map`,
    );
    expect(count?.n).toBe(10);
  });

  it('refuses a load that would drop most shapes (shrink guard) and keeps the old ones', async () => {
    await run();
    // A snapshot with one state only: the stale sweep would delete 7 of 10 rows.
    const dir = await mkdtemp(join(tmpdir(), 'civic-cb-small-'));
    const zips = fixtureZips();
    await writeFile(join(dir, FIXTURE_DISTRICT_ZIP), zips[FIXTURE_DISTRICT_ZIP] ?? '');
    await writeFile(join(dir, FIXTURE_STATE_ZIP), zips[FIXTURE_STATE_ZIP] ?? '');
    const smaller = createCensusBoundariesAdapter(TINY);
    const limited = {
      ...smaller,
      parse: (
        snapshot: Parameters<typeof smaller.parse>[0],
        scope: Parameters<typeof smaller.parse>[1],
        ctx: Parameters<typeof smaller.parse>[2],
      ) =>
        (async function* () {
          for await (const record of smaller.parse(snapshot, scope, ctx)) {
            if (record.state === 'ZA') yield record;
          }
        })(),
    };
    const receipt = await runIngest(
      {
        source: 'census-boundaries',
        scope: SCOPES['census-boundaries'],
        snapshotPath: dir,
        forceReplay: true,
      },
      await testRuntime(handle, { adapters: { 'census-boundaries': limited } }),
    );
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/shrink guard/);
    const [count] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from district_map`,
    );
    expect(count?.n).toBe(10);
    // --allow-shrink commits it and the sweep removes what the new files no longer assert.
    const allowed = await runIngest(
      {
        source: 'census-boundaries',
        scope: SCOPES['census-boundaries'],
        snapshotPath: dir,
        forceReplay: true,
      },
      await testRuntime(handle, {
        adapters: { 'census-boundaries': limited },
        shrinkGuard: {
          maxDeleteFraction: 0.1,
          minRecordRatio: 0.5,
          minBaseline: 20,
          allow: true,
        },
      }),
    );
    expect(allowed).toMatchObject({ status: 'succeeded' });
    expect(allowed.counts.stale_shapes_deleted).toBe(6);
    expect(allowed.note).toMatch(/shrink guard overridden/);
  });

  it('fails a run over the decompression cap and loads nothing', async () => {
    const receipt = await run({ limits: { maxDecompressedBytes: 200 } });
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/decompression cap/);
    const [count] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from district_map`,
    );
    expect(count?.n).toBe(0);
  });

  it('fails the run, loading nothing, when the as-of sentence is gone from the metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'civic-cb-nometa-'));
    const zips = fixtureZips('Synthetic metadata with no date sentence.');
    await writeFile(join(dir, FIXTURE_DISTRICT_ZIP), zips[FIXTURE_DISTRICT_ZIP] ?? '');
    await writeFile(join(dir, FIXTURE_STATE_ZIP), zips[FIXTURE_STATE_ZIP] ?? '');
    const receipt = await run({}, dir);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/as-of date cannot be set/);
    const [count] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from district_map`,
    );
    expect(count?.n).toBe(0);
  });

  /** Serves the fixture zips by URL basename with ETags; 304 when the ETag matches. */
  function fixtureServer() {
    const requests: { url: string; conditional: boolean }[] = [];
    const deps: HttpDeps = {
      fetch: async (input, init) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const name = url.split('/').at(-1) ?? '';
        requests.push({ url, conditional: Boolean(headers['if-none-match']) });
        const etag = `"${name}-v1"`;
        if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
        return new Response(await readFile(join(FIXTURE_DIR, name)), {
          status: 200,
          headers: { etag },
        });
      },
      sleep: async () => {},
      random: () => 0,
    };
    return { deps, requests };
  }

  it('downloads from the Census URLs into data/raw with a sha256 manifest, then dedupes via 304', async () => {
    const server = fixtureServer();
    const rt = await testRuntime(handle, { adapters, http: server.deps });
    const first = await runIngest(
      { source: 'census-boundaries', scope: SCOPES['census-boundaries'] },
      rt,
    );
    expect(first.status).toBe('succeeded');
    expect(server.requests.map((r) => r.url).sort()).toEqual([
      'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_cd119_500k.zip',
      'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_500k.zip',
    ]);
    const dir = join(rt.rawRoot, 'census-boundaries', new Date().toISOString().slice(0, 10));
    expect((await readdir(dir)).sort()).toEqual([
      FIXTURE_DISTRICT_ZIP,
      FIXTURE_STATE_ZIP,
      MANIFEST_FILE,
    ]);
    const manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
    expect(manifest.checksum).toBe(first.snapshotChecksum);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    const second = await runIngest(
      { source: 'census-boundaries', scope: SCOPES['census-boundaries'] },
      rt,
    );
    expect(second).toEqual({ ...first, deduplicated: true });
    expect(server.requests.slice(-2).every((r) => r.conditional)).toBe(true);
  });
});
