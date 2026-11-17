import type { SourceAdapter } from '../../adapter';
import { loadBoundaries } from './load';
import {
  BOUNDARY_FILES,
  type BoundaryMinimums,
  type BoundaryRecord,
  CENSUS_BASE_URL,
  FULL_FILE_MINIMUMS,
  parseBoundaries,
} from './parse';

/**
 * U.S. Census Bureau cartographic boundary files (states and 119th Congress districts):
 * projected, simplified locator-map paths for `districts.shape@1` (DECISIONS A75).
 */
/** `minimums` only exists so tests can load a few-feature fixture; production uses the full-file floor. */
export const createCensusBoundariesAdapter = (
  minimums: BoundaryMinimums = FULL_FILE_MINIMUMS,
): SourceAdapter<BoundaryRecord> => ({
  source: {
    id: 'census-boundaries',
    name: 'U.S. Census Bureau cartographic boundary files',
    url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
    license:
      'U.S. government work, public domain (17 U.S.C. 105); the Census Bureau asks for attribution',
    licenseUrl: 'https://www.census.gov/about/policies/open-gov/open-data.html',
    description:
      'State outlines and congressional district boundaries (500k generalized) for the 119th Congress. Drawn as small locator maps; the maps show the lines as of the date the states provided them, not later redistricting.',
  },
  version: 'census-boundaries@1',
  dependsOn: [],
  scopes: ['all'],
  shrinkDatasets: [{ table: 'district_map', loaded: 'shapes', swept: 'stale_shapes_deleted' }],
  async plan(scope) {
    return {
      source: 'census-boundaries',
      scope,
      requests: BOUNDARY_FILES.map((fileName) => ({
        fileName,
        url: `${CENSUS_BASE_URL}${fileName}`,
        timeoutMs: 180_000,
      })),
    };
  },
  parse: (snapshot, _scope, ctx) => parseBoundaries(snapshot, ctx, minimums),
  load: loadBoundaries,
});

export const censusBoundariesAdapter = createCensusBoundariesAdapter();
