import { join } from 'node:path';
import type { SourceAdapter } from '../../adapter';
import { loadCurated } from './load';
import { type CuratedRecord, listCuratedFiles, parseCurated } from './parse';

/**
 * Git-reviewed curated YAML (data/curated/**): policy-area vocabulary, industry map,
 * frameworks, promises, platforms. Depends on the sources whose rows it references, so a
 * reload of committees, bills or people re-applies it even if the YAML is unchanged.
 */
export const curatedAdapter: SourceAdapter<CuratedRecord> = {
  source: {
    id: 'curated',
    name: 'Civic Ledger curated data',
    url: 'https://github.com/',
    license: 'Project data, reviewed in git; every claim links to a public source.',
    licenseUrl: null,
    description:
      'Human-reviewed YAML: Congress.gov policy areas, the PAC industry map (with coverage), frameworks, promises and platforms.',
  },
  version: 'curated@1',
  dependsOn: ['congress-legislators', 'voteview', 'fec-bulk', 'govinfo-billstatus'],
  scopes: ['all'],
  async plan(scope, ctx) {
    const root = ctx.snapshotPath ?? join(ctx.repoRoot, 'data', 'curated');
    const files = await listCuratedFiles(root);
    return {
      source: 'curated',
      scope,
      requests: files.map((fileName) => ({ fileName, localPath: join(root, fileName) })),
    };
  },
  parse: (snapshot) => parseCurated(snapshot),
  load: loadCurated,
};
