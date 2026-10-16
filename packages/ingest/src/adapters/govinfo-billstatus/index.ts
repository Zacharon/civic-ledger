import type { SourceAdapter } from '../../adapter';
import { loadBillstatus } from './load';
import { BILL_TYPES, type BillRecord, billstatusZip, parseBillstatus } from './parse';

const BASE_URL = 'https://www.govinfo.gov/bulkdata/BILLSTATUS';

function congressOf(scope: { kind: string; congress?: number }): number {
  if (scope.kind !== 'congress' || scope.congress === undefined) {
    throw new Error('govinfo-billstatus needs a congress scope');
  }
  return scope.congress;
}

/** GovInfo BILLSTATUS bulk XML: bills, sponsors, policy area, subjects, recorded votes. */
export const govinfoBillstatusAdapter: SourceAdapter<BillRecord> = {
  source: {
    id: 'govinfo-billstatus',
    name: 'GovInfo Bill Status bulk data',
    url: 'https://www.govinfo.gov/bulkdata/BILLSTATUS',
    license: 'U.S. government work, not subject to copyright (17 U.S.C. 105)',
    licenseUrl: 'https://www.govinfo.gov/about/policies',
    description:
      'Every bill and resolution of a congress with sponsor, Congress.gov policy area, legislative subjects, latest action and the roll-call votes taken on it.',
  },
  version: 'govinfo-billstatus@1',
  dependsOn: ['congress-legislators', 'voteview'],
  scopes: ['congress'],
  async plan(scope) {
    const congress = congressOf(scope);
    return {
      source: 'govinfo-billstatus',
      scope,
      requests: BILL_TYPES.map((type) => ({
        fileName: billstatusZip(congress, type),
        url: `${BASE_URL}/${congress}/${type}/${billstatusZip(congress, type)}`,
        timeoutMs: 600_000,
      })),
    };
  },
  parse: (snapshot, scope) => parseBillstatus(snapshot, congressOf(scope)),
  load: loadBillstatus,
};
