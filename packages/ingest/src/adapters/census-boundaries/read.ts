import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { MultiPolygon, Polygon } from 'geojson';
import { read as readShapefile } from 'shapefile';
import type { ZipLimits } from '../../parse/zip';
import { zipEntries } from '../../parse/zip';

/** One feature of a Census cartographic boundary shapefile. */
export interface BoundaryFeature {
  properties: Record<string, string | number | null>;
  geometry: Polygon | MultiPolygon;
}

export interface BoundaryFile {
  /** Shapefile base name, e.g. `cb_2025_us_cd119_500k`. */
  name: string;
  features: BoundaryFeature[];
  /** Text of the ISO 19115 metadata sidecar (`.shp.iso.xml`), when the zip has one. */
  metadata: string | null;
}

/**
 * The largest inflated entry this adapter accepts. The real files are about 10 MB and 3 MB;
 * 64 MiB leaves room to grow while keeping a hostile or mistaken archive far below the generic
 * 2 GiB ingest cap (the smaller of the two applies).
 */
export const MAX_BOUNDARY_ENTRY_BYTES = 64 * 1024 * 1024;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** Records in a `.shp`: each has an 8-byte header whose second word is its length in 16-bit words. */
export function countShpRecords(shp: Uint8Array, label: string): number {
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  let offset = 100;
  let records = 0;
  while (offset + 8 <= shp.byteLength) {
    const words = view.getInt32(offset + 4, false);
    if (words < 0) throw new Error(`${label}: corrupt .shp record header`);
    offset += 8 + words * 2;
    records += 1;
  }
  if (shp.byteLength < 100 || offset !== shp.byteLength) {
    throw new Error(`${label}: the .shp is truncated or has trailing bytes`);
  }
  return records;
}

/**
 * Reads the one `.shp`, one `.dbf` and optional `.shp.iso.xml` an archive must hold, all at
 * the archive root and named `<expectedBase>.*`. Anything else that looks like shapefile data
 * (a second `.shp`, one in a folder, another base name) fails the run rather than letting the
 * last entry win. Entries are inflated one at a time under the cap; nothing is written to disk
 * and no entry name is used as a path.
 */
export async function readBoundaryZip(
  directory: string,
  fileName: string,
  expectedBase: string,
  limits: ZipLimits = {},
): Promise<BoundaryFile> {
  const slots = new Map<string, Buffer | null>([
    [`${expectedBase}.shp`, null],
    [`${expectedBase}.dbf`, null],
    [`${expectedBase}.shp.iso.xml`, null],
  ]);
  const looksLikeShapefileData = (entry: string) =>
    /\.(shp|dbf)$/i.test(entry) || /\.shp\.iso\.xml$/i.test(entry);
  const maxBytes = Math.min(limits.maxBytes ?? Number.POSITIVE_INFINITY, MAX_BOUNDARY_ENTRY_BYTES);
  for await (const entry of zipEntries(join(directory, fileName), looksLikeShapefileData, {
    maxBytes,
  })) {
    if (!slots.has(entry.name)) {
      throw new Error(
        `${fileName}: unexpected entry "${entry.name}"; expected only ${[...slots.keys()].join(', ')} at the archive root`,
      );
    }
    if (slots.get(entry.name) !== null)
      throw new Error(`${fileName}: duplicate entry "${entry.name}"`);
    slots.set(entry.name, await collect(entry.stream));
  }
  const shp = slots.get(`${expectedBase}.shp`);
  const dbf = slots.get(`${expectedBase}.dbf`);
  if (!shp || !dbf)
    throw new Error(`${fileName} has no ${expectedBase}.shp and ${expectedBase}.dbf pair`);

  const shpRecords = countShpRecords(shp, fileName);
  const dbfRecords = dbf.byteLength >= 8 ? dbf.readUInt32LE(4) : -1;
  if (shpRecords !== dbfRecords) {
    throw new Error(
      `${fileName}: the .shp has ${shpRecords} records but the .dbf has ${dbfRecords}; the pair does not match`,
    );
  }
  // Views over the same bytes: no second copy of a 10 MB file.
  const asBytes = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const collection = await readShapefile(asBytes(shp), asBytes(dbf), { encoding: 'utf-8' });

  const features: BoundaryFeature[] = [];
  for (const [index, f] of collection.features.entries()) {
    const g = f.geometry;
    if (!g) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      throw new Error(
        `${fileName}: feature ${index + 1} (${String(props.GEOID ?? 'no GEOID')}) has no geometry`,
      );
    }
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') {
      throw new Error(`${fileName}: unexpected ${g.type} geometry; expected polygons`);
    }
    features.push({
      properties: (f.properties ?? {}) as BoundaryFeature['properties'],
      geometry: g as Polygon | MultiPolygon,
    });
  }
  if (features.length !== shpRecords) {
    throw new Error(`${fileName}: read ${features.length} features from ${shpRecords} records`);
  }
  return {
    name: expectedBase,
    features,
    metadata: slots.get(`${expectedBase}.shp.iso.xml`)?.toString('utf8') ?? null,
  };
}
