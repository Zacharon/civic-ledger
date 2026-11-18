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
 * Days after a term's recorded end (`end_date`, exclusive) within which a recorded vote in the
 * same chamber is still attributed to that term. Measured on the real 119th Congress data
 * (382,871 stored positions, 2025-01-03 to 2026-09-30): 17 positions had no covering term in
 * their roll call's chamber, 15 cast on the recorded end date (0 days after it) and 2 one day
 * after; none before a term's start and none covered only by a term in the other chamber.
 * The window is that observed maximum plus one day. There is no window before a term starts.
 */
export const VOTE_DATE_GRACE_DAYS = 2;

/**
 * The one resolver for "which term was this member on, for the outer `rollcall` row" (a
 * lateral join). Every vote-date party, chamber and state comes from it: the `votes.list`
 * party breakdown and the `frameworks.evaluate` states and `at_vote` filters.
 *
 * Only terms in an office of the rollcall's chamber are eligible: a House vote is never
 * credited to a Senate term, whatever their dates. Among those:
 * 1. a term covering the vote date (`start_date <= vote_date < coalesce(end_date, infinity)`;
 *    `term.end_date` is exclusive) wins; between covering terms the latest start, then the
 *    highest id (a deterministic tie-break, flagged by `ambiguousTerm`);
 * 2. otherwise a term whose recorded end is at most `VOTE_DATE_GRACE_DAYS` before the vote
 *    date (`end_date <= vote_date <= end_date + VOTE_DATE_GRACE_DAYS`), latest end first, for a
 *    source that records a member's last day slightly before their last vote (`covers` false);
 * 3. otherwise no term: the vote is unattributed. Callers never guess: `votes.list` counts it
 *    in the "Unknown" party row, `frameworks.evaluate` gives `partyAtVote` null, and `at_vote`
 *    chamber/state/party filters do not match it.
 * `covering` counts the covering same-chamber terms, so serving and ambiguity are decided by
 * real coverage, never by the grace window.
 */
export function voteTimeTerm(db: Db, personId: Column | SQL) {
  const covers = or(isNull(term.endDate), gt(term.endDate, rollcall.voteDate)) as SQL;
  const inGrace = sql`(${term.endDate} <= ${rollcall.voteDate} and ${rollcall.voteDate} <= ${term.endDate} + ${sql.raw(String(VOTE_DATE_GRACE_DAYS))})`;
  return db
    .select({
      party: term.party,
      chamber: office.chamber,
      state: office.state,
      covers: sql<boolean>`coalesce(${covers}, false)`.as('covers'),
      covering: sql<number>`(count(*) filter (where ${covers}) over ())::int`.as('covering'),
    })
    .from(term)
    .innerJoin(office, eq(office.id, term.officeId))
    .where(
      and(
        eq(term.personId, personId),
        sql`${office.chamber} = ${rollcall.chamber}`,
        lte(term.startDate, rollcall.voteDate),
        or(covers, inGrace),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${covers}, false)`),
      // Covering terms: latest start. Grace-window terms: latest end.
      desc(
        sql`case when coalesce(${covers}, false) then ${term.startDate} else ${term.endDate} end`,
      ),
      desc(term.id),
    )
    .limit(1)
    .as('vote_time_term');
}

type VoteTimeTerm = ReturnType<typeof voteTimeTerm>;

/** True when the resolved term covers the vote date (false inside the grace window). */
export function coversVoteDate(vt: VoteTimeTerm): SQL<boolean> {
  return sql<boolean>`coalesce(${vt.covers}, false)`;
}

/** True when more than one same-chamber term covers the vote date (one is chosen). */
export function ambiguousTerm(vt: VoteTimeTerm): SQL<boolean> {
  return sql<boolean>`coalesce(${vt.covering} > 1, false)`;
}

/** Serving in the rollcall's chamber on its vote date, per the stored terms. */
export function servingInChamber(vt: VoteTimeTerm): SQL<boolean> {
  return sql<boolean>`coalesce(${vt.covering} > 0, false)`;
}

export function memberVoteState(position: Position | null, serving: boolean): MemberVoteState {
  if (position) return position;
  return serving ? 'unavailable' : 'not_serving';
}
