import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { industryBreakdown, shareOf } from '../src/capabilities/money';
import { dispatch } from '../src/dispatch';
import { useSeededDb } from './helpers';

// Regression for real 2026 data (DECISIONS A29): refunds (negative pas2 rows) made the
// uncoded group net-negative, so a net-based coverage reached 2.0 and -0.39.
const db = useSeededDb();
const REFUNDED = 'avery-ashvale';
const ONLY_REFUNDS = 'blair-brindlemoor';

const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);

async function addContribution(slug: string, committeeFecId: string, cents: number, key: string) {
  await exec(sql`
    insert into committee_contribution
      (fec_sub_id, committee_id, recipient_fec_candidate_id, person_id, cycle, amount_cents,
       transaction_date, transaction_type, source_id, source_key, ingest_run_id, retrieved_at)
    select ${key}, c.id, t.fec_candidate_id, p.id, t.cycle, ${cents}, '2024-11-01', '24K',
       'dev-seed', ${`test:${key}`}, 1, now()
    from person p
    join candidate_cycle_totals t on t.person_id = p.id
    join committee c on c.fec_committee_id = ${committeeFecId}
    where p.slug = ${slug}`);
}

async function codedCommitteeOf(slug: string): Promise<{ fecId: string; cents: number }> {
  const result = await exec(sql`
    select c.fec_committee_id as fec_id, sum(cc.amount_cents)::bigint as cents
    from committee_contribution cc
    join person p on p.id = cc.person_id
    join committee c on c.id = cc.committee_id
    join committee_industry ci on ci.committee_id = c.id
    where p.slug = ${slug}
    group by 1 order by 2 desc, 1 limit 1`);
  const row = result.rows[0] as { fec_id: string; cents: string } | undefined;
  if (!row) throw new Error('seed person has no coded PAC money');
  return { fecId: row.fec_id, cents: Number(row.cents) };
}

beforeAll(async () => {
  // A large refund from an uncoded committee (the member's own principal committee in the
  // seed) and a refund that takes one coded industry below zero.
  const uncoded = await exec(sql`
    select c.fec_committee_id as fec_id from committee c
    left join committee_industry ci on ci.committee_id = c.id
    where ci.id is null and c.designation = 'P' order by 1 limit 1`);
  const uncodedId = (uncoded.rows[0] as { fec_id: string }).fec_id;
  await addContribution(REFUNDED, uncodedId, 1_000_000, 'test-uncoded-gift');
  await addContribution(REFUNDED, uncodedId, -6_000_000, 'test-uncoded-refund');
  const coded = await codedCommitteeOf(REFUNDED);
  await addContribution(REFUNDED, coded.fecId, -(coded.cents + 250_000), 'test-coded-refund');

  // A member whose only PAC entries are refunds: no positive base at all.
  await exec(
    sql`delete from committee_contribution where person_id = (select id from person where slug = ${ONLY_REFUNDS})`,
  );
  await addContribution(ONLY_REFUNDS, uncodedId, -500_000, 'test-only-refund');

  // Negative receipts and a negative unitemized amount (both seen in 2026 FEC files).
  await exec(sql`
    update candidate_cycle_totals set total_receipts_cents = -8829298
    where person_id = (select id from person where slug = ${ONLY_REFUNDS})`);
  await exec(sql`
    update candidate_cycle_summary set unitemized_individual_cents = -730983
    where person_id = (select id from person where slug = ${ONLY_REFUNDS})`);
  await refreshPersonCard(db.handle().db);
});

describe('share math with refunds', () => {
  it('money.summary keeps coverage and shares in [0, 1] and states refunds', async () => {
    const result = await dispatch('money.summary', { slug: REFUNDED }, db.ctx());
    const c = result.industryCoding;
    expect(c.uncodedCents).toBeLessThan(0);
    expect(c.refundsCents).toBeLessThan(0);
    expect(c.totalCents).toBe(c.grossCents + c.refundsCents);
    expect(c.codedGrossCents + c.uncodedGrossCents).toBe(c.grossCents);
    expect(c.coverage).toBe(c.codedGrossCents / c.grossCents);
    expect(c.coverage).toBeGreaterThanOrEqual(0);
    expect(c.coverage).toBeLessThanOrEqual(1);

    const shares = result.industries.reduce((n, i) => n + i.share, 0);
    expect(shares + c.uncodedGrossCents / c.grossCents).toBeCloseTo(1, 10);
    expect(result.industries.some((i) => i.amountCents < 0)).toBe(true);
    for (const i of result.industries) expect(i.amountCents).toBe(i.grossCents + i.refundsCents);
    expect(result.topCommittees.every((t) => t.amountCents > 0)).toBe(true);
  });

  it('person_card uses the same coverage and lists only net-positive industries', async () => {
    const [money, profile] = await Promise.all([
      dispatch('money.summary', { slug: REFUNDED }, db.ctx()),
      dispatch('people.get', { slug: REFUNDED }, db.ctx()),
    ]);
    expect(profile.card.industryCodingCoverage).toBeCloseTo(
      money.industryCoding.coverage ?? -1,
      12,
    );
    expect(profile.card.topIndustries.length).toBeGreaterThan(0);
    expect(profile.card.topIndustries.every((i) => i.amountCents > 0)).toBe(true);
    const negative = money.industries.filter((i) => i.amountCents <= 0).map((i) => i.industry.id);
    expect(profile.card.topIndustries.some((i) => negative.includes(i.id))).toBe(false);
  });

  it('a member with only refunds and negative receipts gets null shares, not nonsense', async () => {
    const [money, profile, table] = await Promise.all([
      dispatch('money.summary', { slug: ONLY_REFUNDS }, db.ctx()),
      dispatch('people.get', { slug: ONLY_REFUNDS }, db.ctx()),
      dispatch('explore.table', { filters: { q: 'Brindlemoor' } }, db.ctx()),
    ]);
    expect(money.industryCoding).toMatchObject({ grossCents: 0, coverage: null });
    expect(money.industries).toEqual([]);
    expect(money.topCommittees).toEqual([]);
    expect(money.totals?.pacShare).toBeNull();
    expect(money.smallDollar?.share).toBeNull();
    expect(profile.card).toMatchObject({
      industryCodingCoverage: null,
      pacShare: null,
      smallDollarShare: null,
      topIndustries: [],
    });
    expect(table.rows[0]?.industryCodingCoverage).toBeNull();
  });
});

describe('industryBreakdown / shareOf (pure)', () => {
  it('returns null coverage for zero and refund-only totals', () => {
    expect(industryBreakdown([]).industryCoding.coverage).toBeNull();
    const refundOnly = industryBreakdown([
      { id: null, name: null, sector: null, netCents: -500, grossCents: 0 },
    ]);
    expect(refundOnly.industryCoding).toMatchObject({ coverage: null, refundsCents: -500 });
    expect(refundOnly.industries).toEqual([]);
  });

  it('never exceeds 1 when the uncoded group nets negative', () => {
    const result = industryBreakdown([
      { id: 'a', name: 'A', sector: 'S', netCents: 3_000, grossCents: 3_000 },
      { id: null, name: null, sector: null, netCents: -1_500, grossCents: 1_000 },
    ]);
    expect(result.industryCoding.coverage).toBe(0.75);
    expect(result.industries[0]?.share).toBe(0.75);
  });

  it('shareOf guards non-positive bases and out-of-range parts', () => {
    expect(shareOf(5, 10)).toBe(0.5);
    expect(shareOf(0, 10)).toBe(0);
    expect(shareOf(5, 0)).toBeNull();
    expect(shareOf(5, -10)).toBeNull();
    expect(shareOf(-1, 10)).toBeNull();
    expect(shareOf(11, 10)).toBeNull();
    expect(shareOf(null, 10)).toBeNull();
  });
});
