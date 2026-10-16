import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('money.summary@1', () => {
  it('returns totals, shares and provenance for the latest cycle', async () => {
    const result = await dispatch('money.summary', { slug: 'avery-ashvale' }, db.ctx());
    expect(result.cycle).toBe(2024);
    expect(result.availableCycles).toEqual([2024]);
    expect(result.totals?.totalReceiptsCents).toBeGreaterThan(0);
    expect(Number.isInteger(result.totals?.totalReceiptsCents)).toBe(true);
    expect(result.totals?.pacShare).toBeGreaterThan(0);
    expect(result.totals?.provenance.sourceKey).toMatch(/^weball:/);
  });

  it('reports industry coding coverage that matches the raw contributions', async () => {
    const slug = 'blair-brindlemoor';
    const result = await dispatch('money.summary', { slug }, db.ctx());
    const raw = await db.handle().db.execute<{ total: string; coded: string }>(sql`
      select sum(cc.amount_cents) as total,
             coalesce(sum(cc.amount_cents) filter (where ci.id is not null), 0) as coded
      from committee_contribution cc
      join person p on p.id = cc.person_id
      left join committee_industry ci on ci.committee_id = cc.committee_id
      where p.slug = ${slug} and cc.cycle = 2024`);
    const total = Number(raw.rows[0]?.total);
    const coded = Number(raw.rows[0]?.coded);
    expect(result.industryCoding).toEqual({
      totalCents: total,
      codedCents: coded,
      uncodedCents: total - coded,
      coverage: coded / total,
    });
    expect(result.industryCoding.uncodedCents).toBeGreaterThan(0);
    const industrySum = result.industries.reduce((n, i) => n + i.amountCents, 0);
    expect(industrySum).toBe(coded);
    expect(result.topCommittees.some((c) => c.industry === null)).toBe(true);
  });

  it('returns an explicit empty summary for a person with no FEC data', async () => {
    const result = await dispatch('money.summary', { slug: 'marlow-northquill' }, db.ctx());
    expect(result).toMatchObject({ cycle: null, totals: null, availableCycles: [] });
    expect(result.industryCoding.coverage).toBeNull();
  });

  it('returns not_found for an unknown slug', async () => {
    await expectCapabilityError(
      dispatch('money.summary', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
  });

  it('rejects an out-of-range cycle', async () => {
    await expectCapabilityError(
      dispatch('money.summary', { slug: 'avery-ashvale', cycle: 1900 }, db.ctx()),
      'invalid_input',
    );
  });
});
