import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

/**
 * T-S2a (evidence-trust 2026-10-19): comparison periods and the agreement drilldown.
 * Fictional House members in state ZP:
 *
 * - Ann and Ben serve from 2019-01-03 (116th and 118th Congress roll calls).
 * - Cal's term starts 2023-01-03: not serving on any 116th roll call.
 *
 * Roll calls (house):  date        Ann      Ben          Cal
 *   98001  116  2019-03-01  yea      yea          -
 *   98002  116  2019-06-01  yea      nay          -
 *   98003  116  2020-02-01  present  yea          -
 *   98004  118  2023-03-01  nay      nay          nay
 *   98005  118  2023-05-01  yea      not_voting   yea
 *   98006  118  2023-07-01  yea      (no record)  nay
 *   98007  118  2023-07-01  nay      yea          yea
 *
 * Money: Ann has 2022 and 2024 FEC totals (and a 2022 candidate summary), Ben only 2024,
 * Cal none. Ideology: Ann has DW-NOMINATE for 116 and 118, Ben only 118, Cal none.
 */
const db = useSeededDb();
const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);
const PROV = sql`'dev-seed', 'test:t-s2a', 1, now()`;

const ANN = 's2-period-ann';
const BEN = 's2-period-ben';
const CAL = 's2-period-cal';
const PEOPLE: Array<[string, string, number, string]> = [
  [ANN, 'Ann', 1, '2019-01-03'],
  [BEN, 'Ben', 2, '2019-01-03'],
  [CAL, 'Cal', 3, '2023-01-03'],
];

const ROLLCALLS: Array<[number, number, string]> = [
  [98001, 116, '2019-03-01'],
  [98002, 116, '2019-06-01'],
  [98003, 116, '2020-02-01'],
  [98004, 118, '2023-03-01'],
  [98005, 118, '2023-05-01'],
  [98006, 118, '2023-07-01'],
  [98007, 118, '2023-07-01'],
];

type Pos = 'yea' | 'nay' | 'present' | 'not_voting';
const POSITIONS: Array<[string, number, Pos]> = [
  [ANN, 98001, 'yea'],
  [BEN, 98001, 'yea'],
  [ANN, 98002, 'yea'],
  [BEN, 98002, 'nay'],
  [ANN, 98003, 'present'],
  [BEN, 98003, 'yea'],
  [ANN, 98004, 'nay'],
  [BEN, 98004, 'nay'],
  [CAL, 98004, 'nay'],
  [ANN, 98005, 'yea'],
  [BEN, 98005, 'not_voting'],
  [CAL, 98005, 'yea'],
  [ANN, 98006, 'yea'],
  [CAL, 98006, 'nay'],
  [ANN, 98007, 'nay'],
  [BEN, 98007, 'yea'],
  [CAL, 98007, 'yea'],
];

// slug, fec id, cycle, receipts, other committees, coverage end
const TOTALS: Array<[string, string, number, number, number, string]> = [
  [ANN, 'H9ZP00001', 2022, 1_000_000, 250_000, '2022-12-31'],
  [ANN, 'H9ZP00001', 2024, 2_000_000, 500_000, '2024-12-31'],
  [BEN, 'H9ZP00002', 2024, 3_000_000, 0, '2024-11-30'],
];

beforeAll(async () => {
  await exec(sql`
    insert into office (level, chamber, state, district)
    select 'federal', 'house'::chamber, 'ZP', d from generate_series(1, 3) d`);
  for (const [slug, first, district, start] of PEOPLE) {
    await exec(sql`
      insert into person (slug, full_name, first_name, last_name, source_id, source_key,
        ingest_run_id, retrieved_at)
      values (${slug}, ${`${first} Period`}, ${first}, 'Period', ${PROV})`);
    await exec(sql`
      insert into term (person_id, office_id, party, start_date, end_date, source_id, source_key,
        ingest_run_id, retrieved_at)
      select p.id, o.id, 'Harbor Party', ${start}, null, ${PROV}
      from person p, office o
      where p.slug = ${slug} and o.state = 'ZP' and o.chamber = 'house' and o.district = ${district}`);
  }
  await exec(sql`
    insert into bill (congress, bill_type, number, title, url, source_id, source_key,
      ingest_run_id, retrieved_at)
    values (116, 'hr', 9801, 'Comparison period test bill (fictional)',
      'https://example.org/s2a', ${PROV})`);
  for (const [number, congress, date] of ROLLCALLS) {
    await exec(sql`
      insert into rollcall (congress, chamber, number, session, clerk_number, vote_date, question,
        result, yea_count, nay_count, source_id, source_key, ingest_run_id, retrieved_at)
      values (${congress}, 'house'::chamber, ${number}, 1, ${number - 97000}, ${date},
        ${`On Passage ${number}`}, 'Passed', 0, 0, ${PROV})`);
  }
  await exec(sql`
    insert into rollcall_bill (rollcall_id, bill_id, is_final_passage, source_id, source_key,
      ingest_run_id, retrieved_at)
    select r.id, b.id, true, ${PROV} from rollcall r, bill b
    where r.number = 98001 and r.congress = 116 and b.congress = 116 and b.number = 9801`);
  for (const [slug, number, position] of POSITIONS) {
    await exec(sql`
      insert into vote_position (rollcall_id, person_id, position, source_id, source_key,
        ingest_run_id, retrieved_at)
      select r.id, p.id, ${position}::vote_position_value, ${PROV}
      from rollcall r, person p where r.number = ${number} and r.chamber = 'house'
        and p.slug = ${slug}`);
  }
  for (const [slug, fecId, cycle, receipts, other, end] of TOTALS) {
    await exec(sql`
      insert into candidate_cycle_totals (fec_candidate_id, cycle, person_id,
        total_receipts_cents, individual_cents, other_committee_cents, party_cents,
        candidate_self_cents, total_disbursements_cents, cash_on_hand_cents, debts_cents,
        coverage_end_date, source_id, source_key, ingest_run_id, retrieved_at)
      select ${fecId}, ${cycle}, p.id, ${receipts}, ${receipts - other}, ${other}, 0, 0, 0, 0, 0,
        ${end}, ${PROV}
      from person p where p.slug = ${slug}`);
  }
  await exec(sql`
    insert into candidate_cycle_summary (fec_candidate_id, cycle, person_id, total_receipts_cents,
      individual_cents, itemized_individual_cents, unitemized_individual_cents, coverage_end_date,
      source_id, source_key, ingest_run_id, retrieved_at)
    select 'H9ZP00001', 2022, p.id, 900000, 600000, 300000, 300000, '2022-09-30', ${PROV}
    from person p where p.slug = ${ANN}`);
  for (const [slug, congress, dim1] of [
    [ANN, 116, -0.3],
    [ANN, 118, -0.2],
    [BEN, 118, 0.4],
  ] as const) {
    await exec(sql`
      insert into ideology_score (person_id, congress, method, dim1, dim2, provisional, source_id,
        source_key, ingest_run_id, retrieved_at)
      select p.id, ${congress}, 'dw-nominate', ${dim1}, 0.1, false, ${PROV}
      from person p where p.slug = ${slug}`);
  }
  await refreshPersonCard(db.handle().db);
});

// Read through `unknown` so a red run (fields absent) fails on values, not on types.
type Loose = Record<string, unknown>;
const compare = async (input: Loose) =>
  (await dispatch('people.compare', input as never, db.ctx())) as unknown as Loose & {
    people: Array<Loose & { slug: string }>;
    voteAgreement: Array<Loose & { a: string; b: string; sharedVotes: number; agreed: number }>;
    periodValues: Array<Loose & { slug: string; money: Loose; ideology: Loose; votes: Loose }>;
  };
const agreement = async (input: Loose) =>
  (await dispatch('people.agreement' as never, input as never, db.ctx())) as unknown as Loose & {
    totals: Loose & { shared: number; agreed: number; disagreed: number; excluded: Loose };
    items: Array<Loose & { rollcall: Loose; states: Loose; outcome: string }>;
    total: number;
  };
const pairOf = (result: Awaited<ReturnType<typeof compare>>, a: string, b: string) => {
  const pair = result.voteAgreement.find((p) => p.a === a && p.b === b);
  if (!pair) throw new Error(`no pair ${a} ${b}`);
  return pair;
};
const valuesOf = (result: Awaited<ReturnType<typeof compare>>, slug: string) => {
  const v = result.periodValues?.find((p) => p.slug === slug);
  if (!v) throw new Error(`no period values for ${slug}`);
  return v;
};
const numbersOf = (items: Array<{ rollcall: Loose }>) => items.map((i) => i.rollcall.number);

describe('people.compare@1 periods (T-S2a)', () => {
  it('1 a selected Congress counts only that Congress’s roll calls and echoes the period', async () => {
    const result = await compare({ slugs: [ANN, BEN, CAL], congress: 116 });
    expect(result.period).toEqual({
      votes: {
        basis: 'congress',
        congress: 116,
        firstVoteDate: '2019-03-01',
        lastVoteDate: '2020-02-01',
      },
      money: { basis: 'latest_per_person', cycle: null },
      ideology: { basis: 'congress', congress: 116 },
    });
    const ab = pairOf(result, ANN, BEN);
    expect([ab.agreed, ab.disagreed, ab.sharedVotes, ab.rate]).toEqual([1, 1, 2, 0.5]);
    expect(ab.excluded).toEqual({
      total: 1,
      notServing: 0,
      unavailable: 0,
      notVoting: 0,
      present: 1,
    });
    // Cal was not serving on any 116th roll call: nothing shared, all three excluded.
    const ac = pairOf(result, ANN, CAL);
    expect([ac.sharedVotes, ac.agreed, ac.rate]).toEqual([0, 0, null]);
    expect(ac.excluded).toMatchObject({ total: 3, notServing: 3 });

    const r118 = await compare({ slugs: [ANN, BEN], congress: 118 });
    const ab118 = pairOf(r118, ANN, BEN);
    expect([ab118.agreed, ab118.disagreed, ab118.sharedVotes]).toEqual([1, 1, 2]);
    expect(r118.period).toMatchObject({
      votes: { basis: 'congress', congress: 118, firstVoteDate: '2023-03-01' },
    });
    expect(r118.availablePeriods).toEqual({ congresses: [118, 116], cycles: [2024, 2022] });
  });

  it('2 the default (no period) reproduces v1 agreement and states the all-loaded period', async () => {
    const result = await compare({ slugs: [ANN, BEN, CAL] });
    expect(result.period).toEqual({
      votes: {
        basis: 'all_loaded',
        congress: null,
        firstVoteDate: '2019-03-01',
        lastVoteDate: '2023-07-01',
      },
      money: { basis: 'latest_per_person', cycle: null },
      ideology: { basis: 'latest_per_person', congress: null },
    });
    const ab = pairOf(result, ANN, BEN);
    expect([ab.agreed, ab.disagreed, ab.sharedVotes, ab.rate]).toEqual([2, 2, 4, 0.5]);
    expect(ab.denominatorRule).toBe('both_recorded_yea_or_nay');
    expect(ab.excluded).toEqual({
      total: 3,
      notServing: 0,
      unavailable: 1,
      notVoting: 1,
      present: 1,
    });
    // Precedence: on 98003 Ann was present and Cal not serving -> counted as not serving.
    expect(pairOf(result, ANN, CAL).excluded).toEqual({
      total: 3,
      notServing: 3,
      unavailable: 0,
      notVoting: 0,
      present: 0,
    });
    const bc = pairOf(result, BEN, CAL);
    expect([bc.agreed, bc.sharedVotes]).toEqual([2, 2]);
    expect(bc.excluded).toMatchObject({ total: 5, notServing: 3, unavailable: 1, notVoting: 1 });
  });

  it('3 the default per-person values are the cards’ latest values, each with its period', async () => {
    const result = await compare({ slugs: [ANN, BEN, CAL] });
    const card = (slug: string) => result.people.find((p) => p.slug === slug) as Loose;
    const ann = valuesOf(result, ANN);
    expect(ann.money).toEqual({
      status: 'available',
      cycle: 2024,
      coverageEndDate: '2024-12-31',
      totalReceiptsCents: card(ANN).totalReceiptsCents,
      pacShare: card(ANN).pacShare,
      smallDollarShare: card(ANN).smallDollarShare,
      smallDollarAsOf: card(ANN).smallDollarAsOf,
      topIndustries: card(ANN).topIndustries,
      industryCodingCoverage: card(ANN).industryCodingCoverage,
      outsideSupportCents: card(ANN).outsideSupportCents,
      outsideOpposeCents: card(ANN).outsideOpposeCents,
    });
    expect(ann.money.totalReceiptsCents).toBe(2_000_000);
    expect(ann.ideology).toEqual({
      status: 'available',
      congress: 118,
      dim1: card(ANN).dwNominateDim1,
      dim2: card(ANN).dwNominateDim2,
    });
    expect(ann.votes).toEqual({
      status: 'available',
      congress: 118,
      votesEligible: 4,
      missedVoteRate: 0,
    });
    expect(valuesOf(result, BEN).votes).toEqual({
      status: 'available',
      congress: 118,
      votesEligible: card(BEN).votesEligible,
      missedVoteRate: card(BEN).missedVoteRate,
    });
    const cal = valuesOf(result, CAL);
    expect(cal.money).toMatchObject({
      status: 'unavailable',
      cycle: null,
      totalReceiptsCents: null,
    });
    expect(cal.ideology).toEqual({ status: 'unavailable', congress: null, dim1: null, dim2: null });
  });

  it('4 a member lacking the selected cycle is unavailable: not zero, not another cycle', async () => {
    const result = await compare({ slugs: [ANN, BEN, CAL], cycle: 2022 });
    expect(result.period).toMatchObject({ money: { basis: 'cycle', cycle: 2022 } });
    const ann = valuesOf(result, ANN);
    const summary = (await dispatch(
      'money.summary',
      { slug: ANN, cycle: 2022 },
      db.ctx(),
    )) as Loose & {
      totals: Loose;
      smallDollar: Loose;
      industryCoding: Loose;
      outsideSpending: Loose;
    };
    expect(ann.money).toEqual({
      status: 'available',
      cycle: 2022,
      coverageEndDate: '2022-12-31',
      totalReceiptsCents: 1_000_000,
      pacShare: 0.25,
      smallDollarShare: summary.smallDollar.share,
      smallDollarAsOf: '2022-09-30',
      topIndustries: [],
      industryCodingCoverage: summary.industryCoding.coverage,
      outsideSupportCents: summary.outsideSpending.supportCents,
      outsideOpposeCents: summary.outsideSpending.opposeCents,
    });
    expect(ann.money.smallDollarShare).toBeCloseTo(1 / 3);
    const nothing = {
      status: 'unavailable',
      cycle: 2022,
      coverageEndDate: null,
      totalReceiptsCents: null,
      pacShare: null,
      smallDollarShare: null,
      smallDollarAsOf: null,
      topIndustries: null,
      industryCodingCoverage: null,
      outsideSupportCents: null,
      outsideOpposeCents: null,
    };
    // Ben has 2024 money only; the 2022 view must not show it.
    expect(valuesOf(result, BEN).money).toEqual(nothing);
    expect(valuesOf(result, CAL).money).toEqual(nothing);
    // The card itself (latest values) is unchanged by the period.
    expect(result.people.find((p) => p.slug === BEN)?.totalReceiptsCents).toBe(3_000_000);
  });

  it('5 a member lacking the selected Congress is unavailable for ideology and votes', async () => {
    const result = await compare({ slugs: [ANN, BEN, CAL], congress: 116 });
    expect(valuesOf(result, ANN).ideology).toEqual({
      status: 'available',
      congress: 116,
      dim1: -0.3,
      dim2: 0.1,
    });
    expect(valuesOf(result, BEN).ideology).toEqual({
      status: 'unavailable',
      congress: 116,
      dim1: null,
      dim2: null,
    });
    expect(valuesOf(result, ANN).votes).toEqual({
      status: 'available',
      congress: 116,
      votesEligible: 3,
      missedVoteRate: 0,
    });
    expect(valuesOf(result, CAL).votes).toEqual({
      status: 'unavailable',
      congress: 116,
      votesEligible: null,
      missedVoteRate: null,
    });
  });

  it('6 rejects malformed periods', async () => {
    await expectCapabilityError(compare({ slugs: [ANN, BEN], congress: 0 }), 'invalid_input');
    await expectCapabilityError(compare({ slugs: [ANN, BEN], cycle: 1800 }), 'invalid_input');
  });
});

describe('people.agreement@1 (T-S2a)', () => {
  it('7 lists the exact shared roll calls with states, newest first (date desc, id desc)', async () => {
    const result = await agreement({ a: ANN, b: BEN, congress: 118 });
    expect(result.period).toEqual({
      basis: 'congress',
      congress: 118,
      firstVoteDate: '2023-03-01',
      lastVoteDate: '2023-07-01',
    });
    expect(numbersOf(result.items)).toEqual([98007, 98006, 98005, 98004]);
    expect(result.items.map((i) => [i.states, i.outcome, i.exclusionReason])).toEqual([
      [{ a: 'nay', b: 'yea' }, 'disagreed', null],
      [{ a: 'yea', b: 'unavailable' }, 'excluded', 'unavailable'],
      [{ a: 'yea', b: 'not_voting' }, 'excluded', 'not_voting'],
      [{ a: 'nay', b: 'nay' }, 'agreed', null],
    ]);
    expect(result.items[0]?.rollcall).toMatchObject({
      congress: 118,
      chamber: 'house',
      session: 1,
      clerkNumber: 1007,
      voteDate: '2023-07-01',
      question: 'On Passage 98007',
    });
    expect(result.totals).toEqual({
      considered: 4,
      shared: 2,
      agreed: 1,
      disagreed: 1,
      excluded: { total: 2, notServing: 0, unavailable: 1, notVoting: 1, present: 0 },
    });
    expect(result.denominatorRule).toBe('both_recorded_yea_or_nay');
  });

  it('8 drilldown totals equal the comparison for the same period, for every pair', async () => {
    for (const congress of [undefined, 116, 118]) {
      const period = congress === undefined ? {} : { congress };
      const result = await compare({ slugs: [ANN, BEN, CAL], ...period });
      for (const pair of result.voteAgreement) {
        const drill = await agreement({ a: pair.a, b: pair.b, ...period, limit: 100 });
        expect(drill.totals.agreed + drill.totals.disagreed).toBe(drill.totals.shared);
        expect(drill.totals.shared, `${pair.a}/${pair.b} ${congress}`).toBe(pair.sharedVotes);
        expect(drill.totals.agreed).toBe(pair.agreed);
        expect(drill.totals.disagreed).toBe(pair.disagreed);
        expect(drill.totals.excluded).toEqual(pair.excluded);
        expect(drill.rate).toBe(pair.rate);
        expect(drill.total).toBe(drill.totals.considered);
      }
    }
  });

  it('9 filters and paginates deterministically, linking the bill when there is one', async () => {
    const disagreed = await agreement({ a: ANN, b: BEN, filter: 'disagreed' });
    expect(numbersOf(disagreed.items)).toEqual([98007, 98002]);
    expect(disagreed.total).toBe(2);
    expect(disagreed.filter).toBe('disagreed');

    const excluded = await agreement({ a: ANN, b: BEN, filter: 'excluded', limit: 1, offset: 1 });
    expect(excluded.total).toBe(3);
    expect(numbersOf(excluded.items)).toEqual([98005]);
    expect([excluded.limit, excluded.offset]).toEqual([1, 1]);

    const agreed = await agreement({ a: ANN, b: BEN, filter: 'agreed', congress: 116 });
    expect(numbersOf(agreed.items)).toEqual([98001]);
    expect(agreed.items[0]?.bill).toMatchObject({ congress: 116, billType: 'hr', number: 9801 });

    const all = await agreement({ a: ANN, b: CAL });
    expect(all.items.find((i) => i.rollcall.number === 98003)).toMatchObject({
      states: { a: 'present', b: 'not_serving' },
      outcome: 'excluded',
      exclusionReason: 'not_serving',
    });
    expect(all.availableCongresses).toEqual([118, 116]);
  });

  it('10 validates its input', async () => {
    await expectCapabilityError(agreement({ a: ANN, b: ANN }), 'invalid_input');
    await expectCapabilityError(agreement({ a: ANN, b: BEN, filter: 'maybe' }), 'invalid_input');
    await expectCapabilityError(agreement({ a: ANN, b: 'nobody-by-this-name' }), 'not_found');
  });
});

describe('people.compare@1 default equals v1 on the seed (T-S2a)', () => {
  /** The v1 handler's agreement query, verbatim in SQL: both yea/nay on the same roll call. */
  const v1Agreement = async (a: string, b: string) => {
    const result = await exec(sql`
      select count(*)::int as shared,
        (count(*) filter (where va.position = vb.position))::int as agreed
      from vote_position va
      join vote_position vb on vb.rollcall_id = va.rollcall_id
      join person pa on pa.id = va.person_id
      join person pb on pb.id = vb.person_id
      where pa.slug = ${a} and pb.slug = ${b}
        and va.position in ('yea', 'nay') and vb.position in ('yea', 'nay')`);
    const row = (result as unknown as { rows: Array<{ shared: number; agreed: number }> }).rows[0];
    return { shared: row?.shared ?? 0, agreed: row?.agreed ?? 0 };
  };

  it('11 every seed pair: agreement and cards equal v1; period values equal the cards', async () => {
    const search = await dispatch('people.search', { limit: 100 }, db.ctx());
    const seed = search.items.map((p) => p.slug).filter((slug) => !slug.startsWith('s2-'));
    expect(seed.length).toBeGreaterThanOrEqual(8);
    for (let i = 0; i + 3 < seed.length; i += 4) {
      const slugs = seed.slice(i, i + 4);
      const result = await compare({ slugs });
      for (const pair of result.voteAgreement) {
        const v1 = await v1Agreement(pair.a, pair.b);
        expect([pair.sharedVotes, pair.agreed], `${pair.a}/${pair.b}`).toEqual([
          v1.shared,
          v1.agreed,
        ]);
        expect(pair.rate).toBe(v1.shared > 0 ? v1.agreed / v1.shared : null);
        expect(pair.disagreed).toBe(v1.shared - v1.agreed);
      }
      for (const card of result.people) {
        const profile = await dispatch('people.get', { slug: card.slug }, db.ctx());
        expect(card).toEqual(profile.card);
        const values = valuesOf(result, card.slug);
        expect(values.money).toMatchObject({
          cycle: card.moneyCycle,
          totalReceiptsCents: card.totalReceiptsCents,
          pacShare: card.pacShare,
          smallDollarShare: card.smallDollarShare,
          topIndustries: card.moneyCycle === null ? null : card.topIndustries,
          outsideSupportCents: card.outsideSupportCents,
        });
        expect(values.votes).toMatchObject({
          votesEligible: card.votesEligible,
          missedVoteRate: card.missedVoteRate,
        });
        expect(values.ideology).toMatchObject({
          congress: card.ideologyCongress,
          dim1: card.dwNominateDim1,
        });
        // The selected-cycle path (money.summary) reproduces the card at the card's own cycle.
        if (typeof card.moneyCycle === 'number') {
          const same = await compare({ slugs, cycle: card.moneyCycle });
          const { coverageEndDate: _c, ...latest } = values.money;
          const { coverageEndDate: _d, ...derived } = valuesOf(same, card.slug).money;
          expect(derived).toEqual(latest);
        }
      }
    }
  });
});
