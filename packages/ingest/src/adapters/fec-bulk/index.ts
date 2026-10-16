import type { SourceAdapter } from '../../adapter';
import { loadFec } from './load';
import { type FecRecord, fecFiles, parseFec } from './parse';

const BASE_URL = 'https://www.fec.gov/files/bulk-downloads';

function cycleOf(scope: { kind: string; cycle?: number }): number {
  if (scope.kind !== 'cycle' || scope.cycle === undefined || scope.cycle % 2 !== 0) {
    throw new Error('fec-bulk needs an even-year cycle scope, e.g. --cycle 2026');
  }
  return scope.cycle;
}

/**
 * FEC bulk data for one two-year cycle: candidates, committees, linkages, candidate totals,
 * committee → candidate contributions and independent expenditures. Individual donor
 * records are never fetched; pas2 payee names are never read (52 U.S.C. 30111(a)(4)).
 */
export const fecBulkAdapter: SourceAdapter<FecRecord> = {
  source: {
    id: 'fec-bulk',
    name: 'Federal Election Commission bulk data',
    url: 'https://www.fec.gov/data/browse-data/?tab=bulk-data',
    license:
      'U.S. government data. Contributor information may not be sold or used for soliciting contributions or commercial purposes (52 U.S.C. 30111(a)(4)); this site shows committee-level aggregates only.',
    licenseUrl: 'https://www.fec.gov/updates/sale-or-use-contributor-information/',
    description:
      'Candidates, committees and their links, candidate cycle totals, PAC and party contributions to candidates, and independent expenditures for or against candidates.',
  },
  version: 'fec-bulk@1',
  dependsOn: ['congress-legislators'],
  scopes: ['cycle'],
  async plan(scope) {
    const cycle = cycleOf(scope);
    const f = fecFiles(cycle);
    const zips = [f.cm.zip, f.cn.zip, f.ccl.zip, f.weball.zip, f.pas2.zip];
    return {
      source: 'fec-bulk',
      scope,
      requests: [
        ...zips.map((fileName) => ({
          fileName,
          url: `${BASE_URL}/${cycle}/${fileName}`,
          timeoutMs: 300_000,
        })),
        { fileName: f.ie, url: `${BASE_URL}/${cycle}/${f.ie}`, timeoutMs: 300_000 },
      ],
    };
  },
  parse: (snapshot, scope) => parseFec(snapshot, cycleOf(scope)),
  load: loadFec,
};
