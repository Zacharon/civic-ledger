import type { Db } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';

/**
 * Data-quality checks run after a pipeline load (docs/INGEST.md): join coverage between
 * sources and the industry-coding gaps worth curating next. Read-only.
 */
export interface QualityReport {
  congress: number;
  cycle: number;
  people: { total: number; currentMembers: number };
  voteview: {
    currentWithIdeology: number;
    currentWithVotes: number;
    rollcalls: number;
    rollcallsLinkedToBills: number;
    rollcallsFinalPassage: number;
    unlinkedNominationVotes: number;
  };
  fec: {
    currentWithFecId: number;
    currentWithCycleTotals: number;
    contributionCents: number;
    contributionCentsToKnownPeople: number;
    outsideSpendingCents: number;
    outsideSpendingCentsOnKnownPeople: number;
  };
  bills: { total: number; withPolicyArea: number; sponsorMatched: number };
  industry: {
    contributionCents: number;
    codedCents: number;
    coverage: number | null;
    topUncoded: { fecCommitteeId: string; name: string; cents: number }[];
  };
}

const n = (value: unknown): number => Number(value ?? 0);

type Row = Record<string, unknown>;

/** The driver-neutral `Db` types raw results as unknown; PGlite and node-postgres both return `{ rows }`. */
async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return ((await db.execute(query)) as { rows: Row[] }).rows;
}

async function one(db: Db, query: ReturnType<typeof sql>): Promise<Row> {
  return (await rows(db, query))[0] ?? {};
}

export async function qualityReport(
  db: Db,
  congress: number,
  cycle: number,
): Promise<QualityReport> {
  // Same rule as core's member scope: a term covers today (start <= today < end).
  const current = sql`(select distinct person_id from term where start_date <= current_date and (end_date is null or end_date > current_date))`;
  const people = await one(
    db,
    sql`select (select count(*) from person) as total, (select count(*) from ${current} c) as current`,
  );
  const voteview = await one(
    db,
    sql`select
      (select count(*) from ${current} c where exists (select 1 from ideology_score i where i.person_id = c.person_id and i.congress = ${congress})) as with_ideology,
      (select count(*) from ${current} c where exists (select 1 from vote_position vp join rollcall r on r.id = vp.rollcall_id where vp.person_id = c.person_id and r.congress = ${congress})) as with_votes,
      (select count(*) from rollcall where congress = ${congress}) as rollcalls,
      (select count(distinct rb.rollcall_id) from rollcall_bill rb join rollcall r on r.id = rb.rollcall_id where r.congress = ${congress}) as linked,
      (select count(distinct rb.rollcall_id) from rollcall_bill rb join rollcall r on r.id = rb.rollcall_id where r.congress = ${congress} and rb.is_final_passage) as final_passage,
      (select count(*) from rollcall r where r.congress = ${congress} and r.question ilike '%nomination%' and not exists (select 1 from rollcall_bill rb where rb.rollcall_id = r.id)) as nominations`,
  );
  const fec = await one(
    db,
    sql`select
      (select count(*) from ${current} c where exists (select 1 from person_identifier pi where pi.person_id = c.person_id and pi.scheme = 'fec_candidate')) as with_fec,
      (select count(*) from ${current} c where exists (select 1 from candidate_cycle_totals t where t.person_id = c.person_id and t.cycle = ${cycle})) as with_totals,
      (select coalesce(sum(amount_cents), 0) from committee_contribution where cycle = ${cycle}) as contrib,
      (select coalesce(sum(amount_cents), 0) from committee_contribution where cycle = ${cycle} and person_id is not null) as contrib_known,
      (select coalesce(sum(amount_cents), 0) from independent_expenditure where cycle = ${cycle}) as ie,
      (select coalesce(sum(amount_cents), 0) from independent_expenditure where cycle = ${cycle} and person_id is not null) as ie_known`,
  );
  const bills = await one(
    db,
    sql`select count(*) as total,
      count(*) filter (where exists (select 1 from bill_policy_area bpa where bpa.bill_id = b.id)) as with_area,
      count(*) filter (where b.sponsor_person_id is not null) as sponsor
      from bill b where b.congress = ${congress}`,
  );
  const industry = await one(
    db,
    // Gross positive dollars, as in person_card and money.summary (refunds excluded).
    sql`select coalesce(sum(cc.amount_cents) filter (where cc.amount_cents > 0), 0) as total,
      coalesce(sum(cc.amount_cents) filter (where ci.id is not null and cc.amount_cents > 0), 0) as coded
      from committee_contribution cc left join committee_industry ci on ci.committee_id = cc.committee_id
      where cc.cycle = ${cycle}`,
  );
  const uncoded = await rows(
    db,
    sql`select c.fec_committee_id, c.name, sum(cc.amount_cents) as cents
      from committee_contribution cc
      join committee c on c.id = cc.committee_id
      left join committee_industry ci on ci.committee_id = c.id
      where cc.cycle = ${cycle} and ci.id is null
      group by c.fec_committee_id, c.name order by cents desc limit 15`,
  );
  const total = n(industry.total);
  return {
    congress,
    cycle,
    people: { total: n(people.total), currentMembers: n(people.current) },
    voteview: {
      currentWithIdeology: n(voteview.with_ideology),
      currentWithVotes: n(voteview.with_votes),
      rollcalls: n(voteview.rollcalls),
      rollcallsLinkedToBills: n(voteview.linked),
      rollcallsFinalPassage: n(voteview.final_passage),
      unlinkedNominationVotes: n(voteview.nominations),
    },
    fec: {
      currentWithFecId: n(fec.with_fec),
      currentWithCycleTotals: n(fec.with_totals),
      contributionCents: n(fec.contrib),
      contributionCentsToKnownPeople: n(fec.contrib_known),
      outsideSpendingCents: n(fec.ie),
      outsideSpendingCentsOnKnownPeople: n(fec.ie_known),
    },
    bills: {
      total: n(bills.total),
      withPolicyArea: n(bills.with_area),
      sponsorMatched: n(bills.sponsor),
    },
    industry: {
      contributionCents: total,
      codedCents: n(industry.coded),
      coverage: total > 0 ? n(industry.coded) / total : null,
      topUncoded: uncoded.map((row) => ({
        fecCommitteeId: String(row.fec_committee_id),
        name: String(row.name),
        cents: n(row.cents),
      })),
    },
  };
}
