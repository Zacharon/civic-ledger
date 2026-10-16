import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('votes.list@1', () => {
  it("lists a member's rollcalls newest first with their position and the bill", async () => {
    const result = await dispatch('votes.list', { slug: 'avery-ashvale', limit: 100 }, db.ctx());
    expect(result.person?.slug).toBe('avery-ashvale');
    expect(result.total).toBe(result.items.length);
    expect(result.items.every((i) => i.rollcall.chamber === 'senate' && i.position !== null)).toBe(
      true,
    );
    const dates = result.items.map((i) => i.rollcall.voteDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(result.items[0]?.bill?.title).toContain('(fictional)');
    expect(result.items[0]?.rollcall.provenance.sourceId).toBe('dev-seed');
  });

  it('filters by policy area and tallies match the stored counts', async () => {
    const result = await dispatch('votes.list', { policyArea: 'health' }, db.ctx());
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.policyArea?.id).toBe('health');
      const byParty = item.byParty.reduce((n, p) => n + p.yea + p.nay + p.present + p.notVoting, 0);
      const total = item.tally.yea + item.tally.nay + item.tally.present + item.tally.notVoting;
      expect(byParty).toBe(total);
      expect(item.byParty.map((p) => p.party)).not.toContain('Unknown');
    }
  });

  it('returns not_found for an unknown person or policy area', async () => {
    await expectCapabilityError(
      dispatch('votes.list', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(
      dispatch('votes.list', { policyArea: 'astrology' }, db.ctx()),
      'not_found',
    );
  });

  it('rejects invalid input', async () => {
    await expectCapabilityError(dispatch('votes.list', { limit: 0 }, db.ctx()), 'invalid_input');
  });
});
