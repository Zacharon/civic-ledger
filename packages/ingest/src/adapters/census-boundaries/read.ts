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

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/**
 * Reads the `.shp`, `.dbf` and `.shp.iso.xml` entries of one boundary zip. Entries are
 * inflated one at a time under the decompression cap; nothing is written to disk and no
 * entry name is used as a path, so a hostile archive cannot escape the snapshot directory.
 */
export async function readBoundaryZip(
  directory: string,
  fileName: string,
  limits: ZipLimits = {},
): Promise<BoundaryFile> {
  let shp: Buffer | null = null;
  let dbf: Buffer | null = null;
  let metadata: string | null = null;
  let name = '';
  const wanted = (entry: string) => /\.(shp|dbf)$/i.test(entry) || /\.shp\.iso\.xml$/i.test(entry);
  for await (const entry of zipEntries(join(directory, fileName), wanted, limits)) {
    const lower = entry.name.toLowerCase();
    const bytes = await collect(entry.stream);
    if (lower.endsWith('.shp.iso.xml')) metadata = bytes.toString('utf8');
    else if (lower.endsWith('.shp')) {
      shp = bytes;
      name = entry.name.replace(/\.shp$/i, '');
    } else if (lower.endsWith('.dbf')) dbf = bytes;
  }
  if (!shp || !dbf) throw new Error(`${fileName} has no .shp and .dbf pair`);
  const collection = await readShapefile(toArrayBuffer(shp), toArrayBuffer(dbf), {
    encoding: 'utf-8',
  });
  const features: BoundaryFeature[] = [];
  for (const f of collection.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') {
      throw new Error(`${fileName}: unexpected ${g.type} geometry; expected polygons`);
    }
    features.push({
      properties: (f.properties ?? {}) as BoundaryFeature['properties'],
      geometry: g as Polygon | MultiPolygon,
    });
  }
  return { name, features, metadata };
}
