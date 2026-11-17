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
 * The term in force for `personId` on the date of the outer `rollcall` row, for a lateral
 * join. Covering = `start_date <= vote_date < coalesce(end_date, infinity)`. Exactly one
 * term is picked: a term in the rollcall's chamber first, then the latest start date, then
 * the highest id. `inChamber` / `covering` count the candidates so callers can flag
 * ambiguity instead of multiplying a position across terms.
 */
export function voteTimeTerm(db: Db, personId: Column | SQL) {
  const sameChamber = sql`${office.chamber} = ${rollcall.chamber}`;
  return db
    .select({
      party: term.party,
      chamber: office.chamber,
      state: office.state,
      covering: sql<number>`(count(*) over ())::int`.as('covering'),
      inChamber: sql<number>`(count(*) filter (where ${sameChamber}) over ())::int`.as(
        'in_chamber',
      ),
    })
    .from(term)
    .innerJoin(office, eq(office.id, term.officeId))
    .where(
      and(
        eq(term.personId, personId),
        lte(term.startDate, rollcall.voteDate),
        or(isNull(term.endDate), gt(term.endDate, rollcall.voteDate)),
      ),
    )
    .orderBy(desc(sameChamber), desc(term.startDate), desc(term.id))
    .limit(1)
    .as('vote_time_term');
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
