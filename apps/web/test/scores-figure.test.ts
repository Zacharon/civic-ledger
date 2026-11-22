import type { CapabilityOutput } from '@civic-ledger/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Scores = CapabilityOutput<'scores.list'>;
const state = vi.hoisted(() => ({
  scores: {} as Scores,
  sources: [] as { id: string; name: string; url: string }[],
  peers: [] as {
    slug: string;
    dwNominateDim1: number;
    dwNominateDim2: number | null;
    ideologyCongress: number;
  }[],
}));
vi.mock('@/server/capabilities', () => ({
  read: async (name: string) =>
    name === 'scores.list' ? state.scores : { total: state.peers.length, rows: state.peers },
}));
vi.mock('@/server/sources', () => ({ sourceInfos: async () => state.sources }));

import { ScoresSection } from '../src/components/profile/scores-section';

const provenance = {
  sourceId: 'voteview',
  sourceKey: 'record-1',
  ingestRunId: 1,
  retrievedAt: '2026-10-04T23:30:00Z',
};
const row = (overrides = {}) => ({
  congress: 119,
  method: 'dw-nominate',
  label: 'DW-NOMINATE (Voteview): academic, roll-call based',
  dim1: 0,
  dim2: 0,
  provisional: false,
  provenance,
  ...overrides,
});
const peer = (slug: string, x: number, y: number | null) => ({
  slug,
  dwNominateDim1: x,
  dwNominateDim2: y,
  ideologyCongress: 119,
});
async function render() {
  return renderToStaticMarkup(
    await ScoresSection({ slug: 'focus', name: 'Example Member', chamber: 'house' }),
  );
}

describe('ScoresSection DW-NOMINATE figure', () => {
  beforeEach(() => {
    state.scores = {
      person: { slug: 'focus', fullName: 'Example Member' },
      ideology: [row()],
      scorecards: [],
      linkOnlyPublishers: [],
    };
    state.sources = [{ id: 'voteview', name: 'Voteview', url: 'https://voteview.com' }];
    state.peers = [peer('focus', 0, 0), peer('zero', 0.2, 0), peer('missing', 0.3, null)];
  });
  it('selects DW-NOMINATE rather than the first competing method', async () => {
    state.scores.ideology.unshift(row({ method: 'aaa', label: 'Other method', dim1: 0.8 }));
    const html = await render();
    expect(html).toContain('data-ideology="dw-nominate"');
    expect(html).toContain('data-value="[119,0,0]"');
  });
  it('keeps missing method distinct from a zero and retains other records', async () => {
    state.scores.ideology = [row({ method: 'aaa', label: 'Other method', dim1: 0.8 })];
    const missing = await render();
    expect(missing).toContain('No DW-NOMINATE estimate is available');
    expect(missing).toContain('aaa');
    state.scores.ideology = [row()];
    const recovered = await render();
    expect(recovered).toContain('data-value="[119,0,0]"');
    expect(recovered).toContain('0.000');
  });
  it('retains true zero while excluding missing second dimensions', async () => {
    const html = await render();
    expect(html).toContain('The plot excludes members without a second dimension');
    expect((html.match(/<circle/g) ?? []).length).toBe(3);
    state.scores.ideology = [row({ dim2: null })];
    const missing = await render();
    expect(missing).toContain('Two-dimensional placement unavailable');
    expect(missing).not.toContain('role="img"');
  });
  it('shows period, selected record retrieval date and source uncertainty', async () => {
    const valid = await render();
    expect(valid).toContain('119th Congress');
    expect(valid).toContain('Oct 4, 2026 UTC');
    expect(valid).toContain('retrieval is not the measurement date');
    state.sources = [];
    const absent = await render();
    expect(absent).toContain('catalogue entry unavailable (voteview)');
    expect(absent).not.toContain('role="img"');
    state.sources = [{ id: 'other', name: 'Other source', url: 'https://example.org' }];
    state.scores.ideology = [row({ provenance: { ...provenance, sourceId: 'other' } })];
    const mismatch = await render();
    expect(mismatch).toContain('Other source');
    expect(mismatch).toContain('Source metadata does not verify Voteview');
    expect(mismatch).not.toContain('role="img"');
  });
  it('retains scorecards and labels other ideology methods in the history', async () => {
    state.scores.ideology.push(row({ congress: 118, method: 'other', label: 'Other' }));
    state.scores.scorecards = [
      {
        publisher: {
          id: 'sample',
          name: 'Sample publisher',
          selfDescribedOrientation: 'independent',
          url: 'https://example.org',
          methodologyUrl: 'https://example.org/method',
        },
        year: 2024,
        score: 80,
        scale: { min: 0, max: 100, label: 'points' },
        methodologyUrl: 'https://example.org/method',
        provenance,
      },
    ];
    const html = await render();
    expect(html).toContain('data-ideology-congress="other:118"');
    expect(html).toContain('Sample publisher');
    expect(html).toContain('record-1');
  });
});
