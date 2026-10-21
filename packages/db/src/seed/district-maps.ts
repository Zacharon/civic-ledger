import { SEED_STATES } from './catalog';

/**
 * Synthetic locator-map geometry for the fictional seed states (ZV-ZZ). They are
 * invented outlines, never real places: a lumpy ring around a centre point, cut into
 * wedge-shaped districts that share their boundary points exactly. The seed exists to
 * exercise the map component, API and MCP without real Census data.
 */
export const SEED_MAP_WIDTH = 240;
export const SEED_MAP_HEIGHT = 180;
export const SEED_MAP_DISTRICTS = 5;
export const SEED_MAP_CONGRESS = 119;
export const SEED_MAP_VINTAGE = 'fictional demonstration geometry (not a real map)';
export const SEED_MAP_PUBLISHER = 'Civic Ledger development seed (fictional)';
export const SEED_MAP_AS_OF = '2026-10-01';

export const SEED_STATE_NAMES: Record<(typeof SEED_STATES)[number], string> = {
  ZV: 'Zevland',
  ZW: 'Zwenmark',
  ZX: 'Xanterra',
  ZY: 'Yelmoor',
  ZZ: 'Zzyrhaven',
};

export interface SeedDistrictMap {
  state: string;
  stateName: string;
  /** null = the state outline. */
  district: number | null;
  viewBoxWidth: number;
  viewBoxHeight: number;
  path: string;
}

const RING_POINTS = 40;

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const toPath = (points: ReadonlyArray<readonly [number, number]>) =>
  `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`;

/** A deterministic lumpy ring: radius varies with two low-frequency waves per state. */
function ring(stateIndex: number): Array<[number, number]> {
  const cx = SEED_MAP_WIDTH / 2;
  const cy = SEED_MAP_HEIGHT / 2;
  const phaseA = 0.9 + stateIndex * 1.3;
  const phaseB = 2.1 + stateIndex * 0.7;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < RING_POINTS; i++) {
    const angle = (i / RING_POINTS) * Math.PI * 2;
    const lump = 1 + 0.12 * Math.sin(3 * angle + phaseA) + 0.08 * Math.sin(5 * angle + phaseB);
    points.push([cx + 96 * lump * Math.cos(angle), cy + 68 * lump * Math.sin(angle)]);
  }
  return points;
}

export function buildSeedDistrictMaps(): SeedDistrictMap[] {
  const maps: SeedDistrictMap[] = [];
  SEED_STATES.forEach((state, stateIndex) => {
    const points = ring(stateIndex);
    const base = {
      state,
      stateName: SEED_STATE_NAMES[state],
      viewBoxWidth: SEED_MAP_WIDTH,
      viewBoxHeight: SEED_MAP_HEIGHT,
    };
    maps.push({ ...base, district: null, path: toPath(points) });
    const centre: [number, number] = [SEED_MAP_WIDTH / 2, SEED_MAP_HEIGHT / 2];
    for (let d = 0; d < SEED_MAP_DISTRICTS; d++) {
      const from = Math.round((d * RING_POINTS) / SEED_MAP_DISTRICTS);
      const to = Math.round(((d + 1) * RING_POINTS) / SEED_MAP_DISTRICTS);
      const edge: Array<[number, number]> = [];
      for (let i = from; i <= to; i++) edge.push(points[i % RING_POINTS] as [number, number]);
      maps.push({ ...base, district: d + 1, path: toPath([centre, ...edge]) });
    }
  });
  return maps;
}
