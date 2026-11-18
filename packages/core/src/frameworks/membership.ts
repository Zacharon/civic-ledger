import { type Db, office, rollcall, term } from '@civic-ledger/db';
import { and, type Column, desc, eq, gt, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { Position } from './score';

/**
 * A member's state on one rollcall. The four recorded positions come from the stored
 * vote; with no stored vote the member is `not_serving` when no term of theirs in an
 * office of the rollcall's chamber covers the vote date, otherwise `unavailable` (serving
 * per the terms, but the source record is missing or not loaded). Absence of a record is
 * never read as non-membership.
 */
export const MEMBER_VOTE_STATES = [
  'yea',
  'nay',
  'present',
  'not_voting',
  'not_serving',
  'unavailable',
] as const;
export type MemberVoteState = (typeof MEMBER_VOTE_STATES)[number];

/**
 * The one resolver for "which term was this member on, on the date of the outer `rollcall`
 * row" (a lateral join). Every vote-date party, chamber and state comes from it: the
 * `votes.list` party breakdown and the `frameworks.evaluate` states and `at_vote` filters.
 *
 * Covering = `start_date <= vote_date < coalesce(end_date, infinity)`: `term.end_date` is
 * exclusive (congress-legislators ends a term on the day the next one starts, and
 * `isCurrentMember` reads it the same way). Candidates are the member's terms started by the
 * vote date, in this order: covering first; then a term in the rollcall's chamber; then the
 * latest start date; then the highest id (a deterministic tie-break). With no covering term
 * the latest earlier term is used (`covers` false): a recorded vote cast after a term's
 * recorded end (sources often end a term a day or two before the member's last vote) keeps
 * that term's party. `covering` / `inChamber` count covering terms only, so callers flag
 * ambiguity and decide serving from real coverage, never from the fallback.
 */
export function voteTimeTerm(db: Db, personId: Column | SQL) {
  const sameChamber = sql`${office.chamber} = ${rollcall.chamber}`;
  const covers = or(isNull(term.endDate), gt(term.endDate, rollcall.voteDate)) as SQL;
  return db
    .select({
      party: term.party,
      chamber: office.chamber,
      state: office.state,
      covers: sql<boolean>`coalesce(${covers}, false)`.as('covers'),
      covering: sql<number>`(count(*) filter (where ${covers}) over ())::int`.as('covering'),
      inChamber:
        sql<number>`(count(*) filter (where ${covers} and ${sameChamber}) over ())::int`.as(
          'in_chamber',
        ),
    })
    .from(term)
    .innerJoin(office, eq(office.id, term.officeId))
    .where(and(eq(term.personId, personId), lte(term.startDate, rollcall.voteDate)))
    .orderBy(
      desc(sql`coalesce(${covers}, false)`),
      desc(sameChamber),
      desc(term.startDate),
      desc(term.id),
    )
    .limit(1)
    .as('vote_time_term');
}

/** True when the resolved term covers the vote date (false for the latest-earlier fallback). */
export function coversVoteDate(vt: VoteTimeTerm): SQL<boolean> {
  return sql<boolean>`coalesce(${vt.covers}, false)`;
}

type VoteTimeTerm = ReturnType<typeof voteTimeTerm>;

/** True when more than one term could supply the vote-time party / seat. */
export function ambiguousTerm(vt: VoteTimeTerm): SQL<boolean> {
  return sql<boolean>`coalesce(${vt.inChamber} > 1 or (${vt.inChamber} = 0 and ${vt.covering} > 1), false)`;
}

/** Serving in the rollcall's chamber on its vote date, per the stored terms. */
export function servingInChamber(vt: VoteTimeTerm): SQL<boolean> {
  return sql<boolean>`coalesce(${vt.inChamber} > 0, false)`;
}

export function memberVoteState(position: Position | null, serving: boolean): MemberVoteState {
  if (position) return position;
  return serving ? 'unavailable' : 'not_serving';
}
