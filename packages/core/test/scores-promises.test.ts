import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('scores.list@1', () => {
  it('attributes every score: publisher, orientation, methodology, year and scale', async () => {
    const result = await dispatch('scores.list', { slug: 'avery-ashvale' }, db.ctx());
    expect(result.ideology[0]).toMatchObject({ method: 'dw-nominate', congress: 119 });
    expect(result.ideology[0]?.label).toContain('roll-call based');
    expect(result.scorecards.length).toBe(4);
    for (const score of result.scorecards) {
      expect(score.publisher.selfDescribedOrientation).not.toBe('');
      expect(score.methodologyUrl).toMatch(/^https:\/\//);
      expect(score.scale).toMatchObject({ min: 0, max: 100 });
      expect(score.year).toBeGreaterThan(2000);
      expect(score.provenance.sourceId).toBe('dev-seed');
    }
  });

  it('shows publishers without cleared terms as links only (no scores)', async () => {
    const result = await dispatch('scores.list', { slug: 'avery-ashvale' }, db.ctx());
    expect(result.linkOnlyPublishers.map((p) => [p.id, p.termsStatus])).toEqual([
      ['sample-policy-institute', 'pending'],
    ]);
    expect(result.scorecards.some((s) => s.publisher.id === 'sample-policy-institute')).toBe(false);
  });

  it('returns not_found and invalid_input', async () => {
    await expectCapabilityError(
      dispatch('scores.list', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(dispatch('scores.list', {}, db.ctx()), 'invalid_input');
  });
});

describe('promises.list@1', () => {
  it('returns promises with ratings, evidence and a kept rate over rated promises', async () => {
    const result = await dispatch('promises.list', { slug: 'avery-ashvale' }, db.ctx());
    expect(result.items.length).toBe(2);
    for (const item of result.items) {
      expect(item.ratings[0]?.evidence[0]?.url).toMatch(/^https:\/\//);
      expect(item.status).toBe(item.ratings[0]?.status);
    }
    const rated = result.items.filter((i) => ['kept', 'compromise', 'broken'].includes(i.status));
    const kept = rated.filter((i) => i.status === 'kept').length;
    expect(result.summary).toEqual({
      total: 2,
      rated: rated.length,
      kept,
      keptRate: rated.length > 0 ? kept / rated.length : null,
    });
  });

  it('filters by status and returns an empty list for people without promises', async () => {
    const kept = await dispatch(
      'promises.list',
      { slug: 'avery-ashvale', status: 'kept' },
      db.ctx(),
    );
    expect(kept.items.every((i) => i.status === 'kept')).toBe(true);
    const none = await dispatch('promises.list', { slug: 'marlow-northquill' }, db.ctx());
    expect(none.summary).toEqual({ total: 0, rated: 0, kept: 0, keptRate: null });
  });

  it('returns not_found and invalid_input', async () => {
    await expectCapabilityError(
      dispatch('promises.list', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(
      dispatch('promises.list', { slug: 'avery-ashvale', status: 'fulfilled' }, db.ctx()),
      'invalid_input',
    );
  });
});
