import { z } from 'zod';
import type { ParseContext, RawSnapshot } from '../../adapter';
import { buildStateShapes, DEFAULT_MAP_OPTIONS, type MapOptions } from './geometry';
import { type BoundaryFeature, readBoundaryZip } from './read';

/**
 * U.S. Census Bureau cartographic boundary files, 500k resolution, the vintage the adapter is
 * pinned to. A new vintage is a deliberate change: update YEAR here, bump the adapter
 * `version`, and re-read the as-of sentence and redistricting notes in the metadata
 * (docs/DATA_SOURCES.md, "Census boundaries").
 */
export const CENSUS_VINTAGE_YEAR = 2025;
export const CENSUS_CONGRESS = 119;
export const CENSUS_BASE_URL = `https://www2.census.gov/geo/tiger/GENZ${CENSUS_VINTAGE_YEAR}/shp/`;
export const DISTRICT_ZIP = `cb_${CENSUS_VINTAGE_YEAR}_us_cd${CENSUS_CONGRESS}_500k.zip`;
export const STATE_ZIP = `cb_${CENSUS_VINTAGE_YEAR}_us_state_500k.zip`;
export const DISTRICT_BASE = DISTRICT_ZIP.replace(/\.zip$/, '');
export const STATE_BASE = STATE_ZIP.replace(/\.zip$/, '');
export const BOUNDARY_FILES = [DISTRICT_ZIP, STATE_ZIP] as const;
export const PUBLISHER = 'U.S. Census Bureau';

/**
 * Entities the Census file has a shape for but that are not mapped: American Samoa and the
 * Northern Mariana Islands are island groups so small and far apart that a ~240 px outline is
 * a scatter of specks. The profile shows no map for their delegates rather than a misleading one.
 */
export const UNMAPPED_TERRITORIES: readonly string[] = ['AS', 'MP'];

export interface BoundaryRecord {
  state: string;
  stateName: string;
  width: number;
  height: number;
  statePath: string;
  districts: Array<{ district: number; path: string; sourceKey: string }>;
  stateSourceKey: string;
  vintage: string;
  publisher: string;
  asOf: string;
  congress: number;
  stats: { verticesIn: number; verticesOut: number; ringsDropped: number };
  /** Census district records without a numbered district (at-large `00`, delegate `98`). */
  wholeStateDistricts: number;
}

const StateProps = z.object({
  STATEFP: z.string().regex(/^\d{2}$/),
  STUSPS: z.string().regex(/^[A-Z]{2}$/),
  NAME: z.string().min(1),
  GEOID: z.string().regex(/^\d{2}$/),
});
const DistrictProps = z.object({
  STATEFP: z.string().regex(/^\d{2}$/),
  CD119FP: z.string().regex(/^(\d{2}|ZZ)$/),
  GEOID: z.string().min(4),
  CDSESSN: z.union([z.string(), z.number()]),
});

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The date the district lines are current to, read from the Census metadata abstract
 * ("...based on information provided to the Census Bureau by the states by May 31, 2024").
 * A missing sentence fails the run: the as-of date is shown to readers and must not be guessed.
 */
export function asOfFromMetadata(metadata: string | null): string {
  const match = metadata?.match(
    /provided to the Census Bureau by the states by ([A-Z][a-z]+) (\d{1,2}), (\d{4})/,
  );
  const month = match ? MONTHS.indexOf(match[1] as string) : -1;
  if (!match || month < 0) {
    throw new Error(
      `${DISTRICT_ZIP}: the metadata no longer states when the states provided district boundaries ("...by the states by <Month D, YYYY>"); the as-of date cannot be set. Read the new abstract and update asOfFromMetadata.`,
    );
  }
  const [, , day, year] = match;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
};

export function vintageLabel(year: number, congress: number): string {
  return `${year} cartographic boundary files, ${ordinal(congress)} Congress`;
}

/**
 * Joins the district file to the state file and builds one record per mapped state, one at
 * a time so the loader can write each state while the next is projected.
 */
export function* iterateBoundaryRecords(
  districtFeatures: readonly BoundaryFeature[],
  stateFeatures: readonly BoundaryFeature[],
  meta: { vintage: string; asOf: string; districtFile: string; stateFile: string },
  options: MapOptions = DEFAULT_MAP_OPTIONS,
  minimums: BoundaryMinimums = FULL_FILE_MINIMUMS,
): Generator<BoundaryRecord> {
  if (districtFeatures.length < minimums.districts || stateFeatures.length < minimums.states) {
    throw new Error(
      `Census boundary files look truncated: ${districtFeatures.length} districts (expected 441) and ${stateFeatures.length} states (expected 56)`,
    );
  }
  const districtsByState = new Map<
    string,
    Array<{ props: z.infer<typeof DistrictProps>; f: BoundaryFeature }>
  >();
  for (const f of districtFeatures) {
    const props = DistrictProps.parse(f.properties);
    if (String(props.CDSESSN) !== String(CENSUS_CONGRESS)) {
      throw new Error(
        `${meta.districtFile}: district ${props.GEOID} is for Congress ${props.CDSESSN}, expected ${CENSUS_CONGRESS}`,
      );
    }
    const list = districtsByState.get(props.STATEFP) ?? [];
    if (list.some((entry) => entry.props.CD119FP === props.CD119FP)) {
      throw new Error(`${meta.districtFile}: duplicate district ${props.GEOID}`);
    }
    list.push({ props, f });
    districtsByState.set(props.STATEFP, list);
  }
  const knownStates = new Set(stateFeatures.map((f) => StateProps.parse(f.properties).STATEFP));
  for (const [statefp, list] of districtsByState) {
    if (!knownStates.has(statefp)) {
      throw new Error(
        `${meta.districtFile}: district ${list[0]?.props.GEOID} has STATEFP ${statefp}, which is not in ${meta.stateFile}`,
      );
    }
  }

  const seen = new Set<string>();
  for (const stateFeature of stateFeatures) {
    const state = StateProps.parse(stateFeature.properties);
    if (UNMAPPED_TERRITORIES.includes(state.STUSPS)) continue;
    if (seen.has(state.STUSPS))
      throw new Error(`${meta.stateFile}: duplicate state ${state.STUSPS}`);
    seen.add(state.STUSPS);
    const entries = districtsByState.get(state.STATEFP) ?? [];
    // `00` (at-large) and `98` (delegate) districts are the whole state: no separate shape.
    const numbered = entries.filter(({ props }) => {
      const n = Number(props.CD119FP);
      return Number.isInteger(n) && n >= 1 && n <= 97;
    });
    const shapes = buildStateShapes(
      {
        state: stateFeature.geometry,
        districts: numbered.map(({ props, f }) => ({
          key: Number(props.CD119FP),
          geometry: f.geometry,
        })),
      },
      options,
    );
    if (shapes.statePath === '')
      throw new Error(`${state.STUSPS}: the state outline simplified to nothing`);
    const districts = numbered.map(({ props }) => {
      const district = Number(props.CD119FP);
      const path = shapes.districtPaths.get(district) ?? '';
      if (path === '')
        throw new Error(`${state.STUSPS}-${district}: the district simplified to nothing`);
      return { district, path, sourceKey: `${meta.districtFile}:${props.GEOID}` };
    });
    yield {
      state: state.STUSPS,
      stateName: state.NAME,
      width: shapes.width,
      height: shapes.height,
      statePath: shapes.statePath,
      districts,
      stateSourceKey: `${meta.stateFile}:${state.GEOID}`,
      vintage: meta.vintage,
      publisher: PUBLISHER,
      asOf: meta.asOf,
      congress: CENSUS_CONGRESS,
      stats: shapes.stats,
      wholeStateDistricts: entries.length - numbered.length,
    };
  }
}

export const buildBoundaryRecords = (
  ...args: Parameters<typeof iterateBoundaryRecords>
): BoundaryRecord[] => [...iterateBoundaryRecords(...args)];

export interface BoundaryMinimums {
  districts: number;
  states: number;
}

/** The full files: 441 districts and 56 states and territories. Fewer means a cut-off file. */
export const FULL_FILE_MINIMUMS: BoundaryMinimums = { districts: 400, states: 50 };

export async function* parseBoundaries(
  snapshot: RawSnapshot,
  ctx: ParseContext = {},
  minimums: BoundaryMinimums = FULL_FILE_MINIMUMS,
): AsyncGenerator<BoundaryRecord> {
  const zipLimits = { maxBytes: ctx.limits?.maxDecompressedBytes };
  const districtFile = await readBoundaryZip(
    snapshot.directory,
    DISTRICT_ZIP,
    DISTRICT_BASE,
    zipLimits,
  );
  const stateFile = await readBoundaryZip(snapshot.directory, STATE_ZIP, STATE_BASE, zipLimits);
  const asOf = asOfFromMetadata(districtFile.metadata);
  const records = iterateBoundaryRecords(
    districtFile.features,
    stateFile.features,
    {
      vintage: vintageLabel(CENSUS_VINTAGE_YEAR, CENSUS_CONGRESS),
      asOf,
      districtFile: districtFile.name,
      stateFile: stateFile.name,
    },
    DEFAULT_MAP_OPTIONS,
    minimums,
  );
  for (const record of records) {
    ctx.signal?.throwIfAborted();
    yield record;
  }
}
