import type { SourceAdapter } from '../../adapter';
import { loadVoteview } from './load';
import { parseVoteview, type VoteviewRecord, voteviewFiles } from './parse';

const BASE_URL = 'https://voteview.com/static/data/out';

function congressOf(scope: { kind: string; congress?: number }): number {
  if (scope.kind !== 'congress' || scope.congress === undefined) {
    throw new Error('voteview needs a congress scope');
  }
  return scope.congress;
}

/** Voteview: rollcalls, member positions and DW-NOMINATE for one congress (both chambers). */
export const voteviewAdapter: SourceAdapter<VoteviewRecord> = {
  source: {
    id: 'voteview',
    name: 'Voteview: Congressional Roll-Call Votes Database',
    url: 'https://voteview.com/',
    license:
      'No license stated; citation requested: Lewis, Poole, Rosenthal, Boche, Rudkin, Sonnet (2026), Voteview: Congressional Roll-Call Votes Database, https://voteview.com/',
    licenseUrl: null,
    description:
      'Every House and Senate rollcall, each member position, and DW-NOMINATE ideology estimates (academic, roll-call based).',
  },
  version: 'voteview@1',
  dependsOn: ['congress-legislators'],
  scopes: ['congress'],
  shrinkDatasets: [
    { table: 'rollcall', loaded: 'rollcalls', scopeColumn: 'congress' },
    { table: 'vote_position', loaded: 'vote_positions' },
    { table: 'ideology_score', loaded: 'ideology_scores', scopeColumn: 'congress' },
  ],
  async plan(scope) {
    const files = voteviewFiles(congressOf(scope));
    return {
      source: 'voteview',
      scope,
      requests: [
        { fileName: files.members, url: `${BASE_URL}/members/${files.members}` },
        {
          fileName: files.rollcalls,
          url: `${BASE_URL}/rollcalls/${files.rollcalls}`,
          timeoutMs: 120_000,
        },
        { fileName: files.votes, url: `${BASE_URL}/votes/${files.votes}`, timeoutMs: 300_000 },
      ],
    };
  },
  parse: (snapshot, scope) => parseVoteview(snapshot, congressOf(scope)),
  load: loadVoteview,
};
