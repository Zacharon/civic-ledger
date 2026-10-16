import type { SourceAdapter } from '../../adapter';
import { loadLegislators } from './load';
import { LEGISLATOR_FILES, type LegislatorRecord, parseLegislators } from './parse';

const BASE_URL = 'https://unitedstates.github.io/congress-legislators/';

/** unitedstates/congress-legislators: the identity spine (bioguide ids, cross-ids, terms). */
export const congressLegislatorsAdapter: SourceAdapter<LegislatorRecord> = {
  source: {
    id: 'congress-legislators',
    name: 'unitedstates/congress-legislators',
    url: 'https://github.com/unitedstates/congress-legislators',
    license: 'CC0 1.0 public domain dedication',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    description:
      'Every member of Congress since 1789 with Bioguide, FEC, ICPSR and other ids and every term (chamber, state, district, party).',
  },
  version: 'congress-legislators@1',
  dependsOn: [],
  scopes: ['all'],
  shrinkDatasets: [
    { table: 'person', loaded: 'people' },
    { table: 'term', loaded: 'terms', swept: 'stale_terms_deleted' },
    { table: 'person_identifier', loaded: 'identifiers', swept: 'stale_identifiers_deleted' },
  ],
  async plan(scope) {
    return {
      source: 'congress-legislators',
      scope,
      requests: LEGISLATOR_FILES.map((fileName) => ({
        fileName,
        url: `${BASE_URL}${fileName}`,
        timeoutMs: 120_000,
      })),
    };
  },
  parse: (snapshot) => parseLegislators(snapshot),
  load: loadLegislators,
};
