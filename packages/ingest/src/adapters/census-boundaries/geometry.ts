import type { GeoGeometryObjects, GeoStream } from 'd3-geo';
import { geoArea, geoBounds, geoConicEqualArea, geoPath, geoStream } from 'd3-geo';
import type { MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';

/**
 * Locator-map geometry (DECISIONS A72). Pure functions, no I/O:
 *   lon/lat polygons -> per-state conic equal-area projection -> shared-border-safe
 *   Visvalingam simplification in map pixels -> compact SVG path data.
 * The projection is built per state so Alaska (Aleutians across the antimeridian), Hawaii,
 * Texas and Maine each fill the box sensibly. d3's spherical clipping cuts rings at the
 * antimeridian of the rotated sphere, so no ring ever jumps across the map.
 */

type SimplifiableTopology = Parameters<typeof presimplify>[0];

export type Ring = Array<[number, number]>;
/** Exterior ring first, then holes. */
export type PolygonRings = Ring[];

export interface MapOptions {
  /** Largest map width / height in CSS pixels (the viewBox never exceeds them). */
  maxWidth: number;
  maxHeight: number;
  /** Empty margin so a 1 px stroke is never clipped. */
  padding: number;
  /** Visvalingam threshold in square pixels: points whose triangle is smaller are dropped. */
  simplifyArea: number;
  /** Rings smaller than this (square pixels) are dropped; the largest polygon always stays. */
  minRingArea: number;
}

export const DEFAULT_MAP_OPTIONS: MapOptions = {
  maxWidth: 240,
  maxHeight: 200,
  padding: 2,
  simplifyArea: 0.3,
  minRingArea: 0.8,
};

export interface StateGeometryInput {
  /** The state outline, lon/lat degrees. */
  state: Polygon | MultiPolygon;
  /** Numbered districts, lon/lat degrees. */
  districts: ReadonlyArray<{ key: number; geometry: Polygon | MultiPolygon }>;
}

export interface StateShapes {
  width: number;
  height: number;
  statePath: string;
  districtPaths: Map<number, string>;
  /** Counts for the receipt: vertices before and after, dropped rings. */
  stats: { verticesIn: number; verticesOut: number; ringsDropped: number };
}

const polygonsOf = (g: Polygon | MultiPolygon): number[][][][] =>
  g.type === 'Polygon' ? [g.coordinates] : g.coordinates;

const countVertices = (g: Polygon | MultiPolygon): number =>
  polygonsOf(g).reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);

/** Longest straight lon/lat edge left after densifying, in degrees (about 5 km). */
export const MAX_EDGE_DEGREES = 0.05;

/**
 * Census (like every GIS shapefile) draws an edge as a straight line in longitude/latitude:
 * Colorado's northern border is a parallel. d3 draws every edge as a great circle, which bows
 * a long parallel toward the pole (about 2 px on a 240 px Colorado). Adding points along long
 * edges makes d3 follow the parallel. Edges that cross the antimeridian are left alone.
 */
export function densify(g: Polygon | MultiPolygon, maxStep = MAX_EDGE_DEGREES): MultiPolygon {
  const ring = (points: number[][]): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i] as number[];
      out.push(a);
      const b = points[i + 1];
      if (!b) continue;
      const dx = (b[0] as number) - (a[0] as number);
      const dy = (b[1] as number) - (a[1] as number);
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep);
      if (Math.abs(dx) > 180 || steps < 2) continue;
      for (let k = 1; k < steps; k++) {
        out.push([(a[0] as number) + (dx * k) / steps, (a[1] as number) + (dy * k) / steps]);
      }
    }
    return out;
  };
  return {
    type: 'MultiPolygon',
    coordinates: polygonsOf(g).map((rings) => rings.map(ring)),
  };
}

/**
 * d3 treats a clockwise ring as the small side of the sphere. Shapefile exteriors are
 * clockwise (d3's convention already), but a hand-made file may not be: any polygon
 * covering more than a hemisphere is reversed rather than drawn as the whole world.
 */
export function windForD3(g: Polygon | MultiPolygon): MultiPolygon {
  const polygons = polygonsOf(g).map((rings) => {
    const area = geoArea({ type: 'Polygon', coordinates: rings });
    return area > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings;
  });
  return { type: 'MultiPolygon', coordinates: polygons };
}

/** Central meridian and latitude range of a lon/lat geometry, antimeridian-aware. */
export function geographicExtent(g: MultiPolygon): {
  centralLongitude: number;
  south: number;
  north: number;
} {
  const [[west, south], [east, north]] = geoBounds(g);
  const spanEast = east >= west ? east - west : east + 360 - west;
  let centralLongitude = west + spanEast / 2;
  if (centralLongitude > 180) centralLongitude -= 360;
  return { centralLongitude, south, north };
}

/** A conic equal-area projection centred on the state, fitted into the box. */
export function projectionFor(state: MultiPolygon, options: MapOptions) {
  const { centralLongitude, south, north } = geographicExtent(state);
  const span = north - south;
  const projection = geoConicEqualArea()
    .parallels([south + span / 6, north - span / 6])
    .rotate([-centralLongitude, 0])
    .center([0, (south + north) / 2]);
  const { maxWidth, maxHeight, padding } = options;
  projection.fitExtent(
    [
      [padding, padding],
      [maxWidth - padding, maxHeight - padding],
    ],
    state,
  );
  // Shift so the drawing starts exactly at the padding, then size the box to the drawing.
  const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(state);
  const [tx, ty] = projection.translate();
  projection.translate([tx + padding - x0, ty + padding - y0]);
  const width = Math.min(maxWidth, Math.ceil(x1 - x0 + 2 * padding));
  const height = Math.min(maxHeight, Math.ceil(y1 - y0 + 2 * padding));
  return { projection, width, height };
}

/** Streams a lon/lat geometry through the projection and collects the planar polygons. */
export function projectPolygons(
  projection: ReturnType<typeof geoConicEqualArea>,
  g: MultiPolygon,
): PolygonRings[] {
  const polygons: PolygonRings[] = [];
  let rings: PolygonRings = [];
  let ring: Ring = [];
  const sink: GeoStream = {
    point(x, y) {
      const last = ring[ring.length - 1];
      const px = Math.round(x * 100) / 100;
      const py = Math.round(y * 100) / 100;
      if (!last || last[0] !== px || last[1] !== py) ring.push([px, py]);
    },
    lineStart() {
      ring = [];
    },
    lineEnd() {
      if (ring.length >= 3) {
        const first = ring[0] as [number, number];
        const last = ring[ring.length - 1] as [number, number];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
        if (ring.length >= 4) rings.push(ring);
      }
      ring = [];
    },
    polygonStart() {
      rings = [];
    },
    polygonEnd() {
      if (rings.length > 0) polygons.push(rings);
      rings = [];
    },
    sphere() {},
  };
  geoStream(g as GeoGeometryObjects, projection.stream(sink));
  return polygons;
}

/** Signed shoelace area of a closed ring (square pixels; sign is the winding). */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as [number, number];
    const b = ring[i + 1] as [number, number];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/**
 * Drops holes and polygons smaller than `minArea` (always keeping the largest polygon) and
 * any ring that simplification collapsed below a triangle.
 */
export function dropSpecks(
  polygons: PolygonRings[],
  minArea: number,
): { polygons: PolygonRings[]; dropped: number } {
  let dropped = 0;
  const valid = polygons.filter((rings) => (rings[0]?.length ?? 0) >= 4);
  const largest = [...valid].sort(
    (a, b) => Math.abs(ringArea(b[0] as Ring)) - Math.abs(ringArea(a[0] as Ring)),
  )[0];
  const kept: PolygonRings[] = [];
  for (const rings of valid) {
    const exterior = rings[0] as Ring;
    if (rings !== largest && Math.abs(ringArea(exterior)) < minArea) {
      dropped += rings.length;
      continue;
    }
    const holes = rings.slice(1).filter((hole) => {
      const keep = hole.length >= 4 && Math.abs(ringArea(hole)) >= minArea;
      if (!keep) dropped += 1;
      return keep;
    });
    kept.push([exterior, ...holes]);
  }
  return { polygons: kept, dropped };
}

const tenths = (n: number) => Math.round(n * 10);

/** An integer count of tenths as the shortest SVG number: 12 -> "1.2", -5 -> "-.5". */
export function formatTenths(n: number): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 10);
  const frac = abs % 10;
  return `${sign}${whole === 0 ? '' : whole}${frac === 0 ? '' : `.${frac}`}`;
}

/**
 * SVG path data: absolute `M` then relative `l` deltas in tenths of a pixel (about half the
 * bytes of absolute coordinates), one subpath per ring, closed with `Z`. The `Z` returns to
 * the ring start, so the next `M` stays absolute and rounding cannot drift across rings.
 */
export function toPathData(polygons: readonly PolygonRings[]): string {
  const parts: string[] = [];
  for (const rings of polygons) {
    for (const ring of rings) {
      const start = ring[0] as [number, number];
      let px = tenths(start[0]);
      let py = tenths(start[1]);
      let d = `M${formatTenths(px)} ${formatTenths(py)}l`;
      let previous = '';
      let segments = 0;
      for (let i = 1; i < ring.length - 1; i++) {
        const p = ring[i] as [number, number];
        const x = tenths(p[0]);
        const y = tenths(p[1]);
        if (x === px && y === py) continue;
        const dx = formatTenths(x - px);
        const dy = formatTenths(y - py);
        // A number may follow another with no separator only when it starts with "-".
        const sepBefore = previous !== '' && !dx.startsWith('-') ? ' ' : '';
        const sepBetween = dy.startsWith('-') ? '' : ' ';
        d += `${sepBefore}${dx}${sepBetween}${dy}`;
        previous = dy;
        px = x;
        py = y;
        segments += 1;
      }
      if (segments >= 2) parts.push(`${d}Z`);
    }
  }
  return parts.join('');
}

/**
 * The whole pipeline for one state. The outline and the districts are simplified together
 * in one topology, so districts that share a border keep sharing it.
 */
export function buildStateShapes(
  input: StateGeometryInput,
  options: MapOptions = DEFAULT_MAP_OPTIONS,
): StateShapes {
  const stateGeo = windForD3(densify(input.state));
  const { projection, width, height } = projectionFor(stateGeo, options);
  const asGeometry = (polygons: PolygonRings[]): MultiPolygon => ({
    type: 'MultiPolygon',
    coordinates: polygons,
  });
  const objects: Record<string, MultiPolygon> = {
    state: asGeometry(projectPolygons(projection, stateGeo)),
  };
  for (const d of input.districts) {
    objects[`d${d.key}`] = asGeometry(projectPolygons(projection, windForD3(densify(d.geometry))));
  }
  // topojson-server / -simplify type their topologies with incompatible property generics.
  const weighted = presimplify(topology(objects) as unknown as SimplifiableTopology);
  const simplified = simplify(weighted as unknown as SimplifiableTopology, options.simplifyArea);

  let ringsDropped = 0;
  let verticesOut = 0;
  const finish = (name: string): string => {
    const geometry = simplified.objects[name];
    if (!geometry) return '';
    const result = feature(simplified, geometry as never) as unknown as {
      geometry: Polygon | MultiPolygon | null;
    };
    const polygons = result.geometry ? polygonsOf(result.geometry) : [];
    const cleaned = dropSpecks(polygons as PolygonRings[], options.minRingArea);
    ringsDropped += cleaned.dropped;
    verticesOut += cleaned.polygons.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
    return toPathData(cleaned.polygons);
  };

  const districtPaths = new Map<number, string>();
  for (const d of input.districts) districtPaths.set(d.key, finish(`d${d.key}`));
  const statePath = finish('state');
  const verticesIn =
    countVertices(input.state) + input.districts.reduce((n, d) => n + countVertices(d.geometry), 0);
  return {
    width,
    height,
    statePath,
    districtPaths,
    stats: { verticesIn, verticesOut, ringsDropped },
  };
}
