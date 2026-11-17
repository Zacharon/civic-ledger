import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Deterministic, synthetic Census-style boundary zips for tests. The shapes are invented
 * (fictional state names, fake FIPS codes) but use the real layout: an ESRI shapefile (.shp
 * with clockwise exterior rings, .dbf), the ISO metadata sidecar the as-of date is read from,
 * and the property names of `cb_2025_us_cd119_500k` / `cb_2025_us_state_500k`.
 * `pnpm exec tsx packages/ingest/test/support/census-fixture.ts` rewrites the committed zips
 * in `test/fixtures/census-boundaries/`; a test fails when they drift from this file.
 */

type Pt = [number, number];
export type FixtureRing = Pt[];
export interface FixtureFeature {
  properties: Record<string, string | number>;
  /** Polygons of rings, exterior first (written clockwise), holes after (counter-clockwise). */
  polygons: FixtureRing[][];
}

const rect = (x0: number, y0: number, x1: number, y1: number): FixtureRing => [
  [x0, y0],
  [x0, y1],
  [x1, y1],
  [x1, y0],
  [x0, y0],
];

/** A wavy vertical border from (x, y0) up to (x, y1): many tiny vertices for simplification. */
const border = (x: number, y0: number, y1: number): Pt[] => {
  const out: Pt[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    out.push([x + 0.004 * Math.sin(i * 1.7) + 0.05 * Math.sin(i / 9), y]);
  }
  return out;
};

/** A strip between two wavy borders (west border shared with the previous strip). */
const strip = (xWest: number, xEast: number, y0: number, y1: number): FixtureRing => {
  const west = border(xWest, y0, y1);
  const east = border(xEast, y0, y1);
  // Clockwise seen with north up: up the west side, down the east side.
  return [...west, ...[...east].reverse(), west[0] as Pt];
};

const reverse = (ring: FixtureRing): FixtureRing => [...ring].reverse();

// State ZA: three strips sharing wavy borders, a lake (hole) in strip 2, a speck island in 3.
const lake = reverse(rect(12.0, 41.0, 12.3, 41.3));
const speck = rect(13.5, 40.2, 13.51, 40.21);
const zaStrips = [strip(10, 11.5, 40, 44), strip(11.5, 13, 40, 44), strip(13, 14, 40, 44)];

const state = (
  fp: string,
  usps: string,
  name: string,
  polygons: FixtureRing[][],
): FixtureFeature => ({
  properties: {
    STATEFP: fp,
    STATENS: `00${fp}`,
    GEOIDFQ: `0400000US${fp}`,
    GEOID: fp,
    STUSPS: usps,
    NAME: name,
    LSAD: '00',
    ALAND: 1_000_000,
    AWATER: 1_000,
  },
  polygons,
});

const district = (
  fp: string,
  cd: string,
  polygons: FixtureRing[][],
  session = '119',
): FixtureFeature => ({
  properties: {
    STATEFP: fp,
    CD119FP: cd,
    GEOIDFQ: `5001900US${fp}${cd}`,
    GEOID: `${fp}${cd}`,
    NAMELSAD:
      cd === '00' ? 'Congressional District (at Large)' : `Congressional District ${Number(cd)}`,
    LSAD: 'C2',
    CDSESSN: session,
    ALAND: 500_000,
    AWATER: 500,
  },
  polygons,
});

export const FIXTURE_STATES: FixtureFeature[] = [
  // ZA: three numbered districts, a hole, a speck island that must be dropped.
  state('90', 'ZA', 'Zalia', [[strip(10, 14, 40, 44), lake], [speck]]),
  // ZB: crosses the antimeridian; one polygon on each side of 180, like Alaska's Aleutians.
  state('91', 'ZB', 'Zbeland', [[rect(172, 52, 180, 56)], [rect(-180, 52, -165, 56)]]),
  // ZC: an at-large state.
  state('92', 'ZC', 'Zcarria', [[rect(100, 30, 101.5, 32)]]),
  // ZD: a delegate territory (Census district code 98).
  state('93', 'ZD', 'Zdistrict', [[rect(-77.2, 38.8, -76.9, 39.0)]]),
  // ZE: high latitude, two districts side by side.
  state('94', 'ZE', 'Zearctica', [[rect(-30, 70, -10, 72)]]),
  // AS: a real territory code the adapter leaves unmapped (invented specks here).
  state('60', 'AS', 'American Samoa (test shape)', [
    [rect(-170.9, -14.4, -170.8, -14.3)],
    [rect(-169.5, -14.3, -169.4, -14.2)],
  ]),
];

export const FIXTURE_DISTRICTS: FixtureFeature[] = [
  district('90', '01', [[zaStrips[0] as FixtureRing]]),
  district('90', '02', [[zaStrips[1] as FixtureRing, lake]]),
  district('90', '03', [[zaStrips[2] as FixtureRing], [speck]]),
  district('91', '00', [[rect(172, 52, 180, 56)], [rect(-180, 52, -165, 56)]]),
  district('92', '00', [[rect(100, 30, 101.5, 32)]]),
  district('93', '98', [[rect(-77.2, 38.8, -76.9, 39.0)]]),
  district('94', '01', [[rect(-30, 70, -20, 72)]]),
  district('94', '02', [[rect(-20, 70, -10, 72)]]),
  district('60', '98', [
    [rect(-170.9, -14.4, -170.8, -14.3)],
    [rect(-169.5, -14.3, -169.4, -14.2)],
  ]),
];

export const FIXTURE_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<gmi:MI_Metadata xmlns:gmi="http://www.isotc211.org/2005/gmi"><abstract>Synthetic test metadata. Congressional districts are the 441 areas from which people are elected. The generalized boundaries of all other congressional districts are based on information provided to the Census Bureau by the states by May 31, 2024. </abstract></gmi:MI_Metadata>
`;

// ESRI shapefile writer -------------------------------------------------------------------

const ringBox = (rings: FixtureRing[]) => {
  const xs = rings.flatMap((r) => r.map((p) => p[0]));
  const ys = rings.flatMap((r) => r.map((p) => p[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
};

/** Signed area; positive = counter-clockwise. */
const signedArea = (ring: FixtureRing) => {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as Pt;
    const b = ring[i + 1] as Pt;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

const asClockwise = (ring: FixtureRing) => (signedArea(ring) > 0 ? reverse(ring) : ring);
const asCounterClockwise = (ring: FixtureRing) => (signedArea(ring) < 0 ? reverse(ring) : ring);

export function shpBuffer(features: readonly FixtureFeature[]): Buffer {
  const records = features.map((f, index) => {
    const rings = f.polygons.flatMap((p) =>
      p.map((ring, i) => (i === 0 ? asClockwise(ring) : asCounterClockwise(ring))),
    );
    const [x0, y0, x1, y1] = ringBox(rings);
    const points = rings.flat();
    const content = Buffer.alloc(44 + 4 * rings.length + 16 * points.length);
    content.writeInt32LE(5, 0);
    for (const [i, v] of [x0, y0, x1, y1].entries()) content.writeDoubleLE(v, 4 + 8 * i);
    content.writeInt32LE(rings.length, 36);
    content.writeInt32LE(points.length, 40);
    let start = 0;
    rings.forEach((r, i) => {
      content.writeInt32LE(start, 44 + 4 * i);
      start += r.length;
    });
    points.forEach((p, i) => {
      content.writeDoubleLE(p[0], 44 + 4 * rings.length + 16 * i);
      content.writeDoubleLE(p[1], 52 + 4 * rings.length + 16 * i);
    });
    const header = Buffer.alloc(8);
    header.writeInt32BE(index + 1, 0);
    header.writeInt32BE(content.length / 2, 4);
    return { buffer: Buffer.concat([header, content]), box: [x0, y0, x1, y1] as const };
  });
  const body = Buffer.concat(records.map((r) => r.buffer));
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE((100 + body.length) / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  const all = ringBox(
    records.map(
      (r) =>
        [
          [r.box[0], r.box[1]],
          [r.box[2], r.box[3]],
        ] as FixtureRing,
    ),
  );
  for (const [i, v] of all.entries()) header.writeDoubleLE(v, 36 + 8 * i);
  return Buffer.concat([header, body]);
}

export function dbfBuffer(features: readonly FixtureFeature[]): Buffer {
  const first = features[0]?.properties ?? {};
  const fields = Object.keys(first).map((name) => {
    const numeric = typeof first[name] === 'number';
    const width = numeric
      ? 15
      : Math.max(2, ...features.map((f) => String(f.properties[name]).length));
    return { name, numeric, width };
  });
  const recordLength = 1 + fields.reduce((n, f) => n + f.width, 0);
  const headerLength = 32 + 32 * fields.length + 1;
  const header = Buffer.alloc(32);
  header[0] = 3;
  header.writeUInt32LE(features.length, 4);
  header.writeUInt16LE(headerLength, 8);
  header.writeUInt16LE(recordLength, 10);
  const descriptors = fields.map((f) => {
    const d = Buffer.alloc(32);
    d.write(f.name, 0, 'latin1');
    d.write(f.numeric ? 'N' : 'C', 11, 'latin1');
    d[16] = f.width;
    return d;
  });
  const rows = features.map((feature) => {
    const parts = fields.map((f) => {
      const text = String(feature.properties[f.name]);
      return f.numeric ? text.padStart(f.width, ' ') : text.padEnd(f.width, ' ');
    });
    return Buffer.from(` ${parts.join('')}`, 'utf8');
  });
  return Buffer.concat([header, ...descriptors, Buffer.from([0x0d]), ...rows, Buffer.from([0x1a])]);
}

// Multi-entry zip writer ----------------------------------------------------------------------

export function zipEntries(entries: ReadonlyArray<{ name: string; content: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

export const FIXTURE_DISTRICT_ZIP = 'cb_2025_us_cd119_500k.zip';
export const FIXTURE_STATE_ZIP = 'cb_2025_us_state_500k.zip';

export function fixtureZips(metadata: string | null = FIXTURE_METADATA): Record<string, Buffer> {
  const entries = (base: string, features: FixtureFeature[], withMetadata: boolean) => [
    { name: `${base}.shp`, content: shpBuffer(features) },
    { name: `${base}.dbf`, content: dbfBuffer(features) },
    ...(withMetadata && metadata !== null
      ? [{ name: `${base}.shp.iso.xml`, content: Buffer.from(metadata, 'utf8') }]
      : []),
  ];
  return {
    [FIXTURE_DISTRICT_ZIP]: zipEntries(entries('cb_2025_us_cd119_500k', FIXTURE_DISTRICTS, true)),
    [FIXTURE_STATE_ZIP]: zipEntries(entries('cb_2025_us_state_500k', FIXTURE_STATES, false)),
  };
}

export function writeFixtureZips(directory: string): void {
  mkdirSync(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(fixtureZips())) {
    writeFileSync(join(directory, name), bytes);
  }
}

if (process.argv[1]?.endsWith('census-fixture.ts')) {
  writeFixtureZips(join(import.meta.dirname, '..', 'fixtures', 'census-boundaries'));
}
