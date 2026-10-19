import {
  bill,
  type Db,
  person,
  rollcall,
  rollcallBill,
  VOTE_POSITIONS,
  votePosition,
} from '@civic-ledger/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  type MemberVoteState,
  memberVoteState,
  servingInChamber,
  voteTimeTerm,
} from '../frameworks/membership';
import {
  BillRefSchema,
  CongressSchema,
  IsoDateSchema,
  PageSchema,
  PaginationInput,
  PersonRefSchema,
  RollcallRefSchema,
  ShareSchema,
  SlugSchema,
} from '../schemas/common';
import { MemberVoteStateSchema } from './frameworks';

/**
 * Pairwise vote agreement, one rule for `people.compare` and `people.agreement`.
 *
 * Considered roll calls: those in the period where at least one of the two members has a
 * stored position. Each member's state on one comes from T-C's membership rule
 * (`frameworks/membership.ts`): the stored position, else `not_serving` (no term in an
 * office of the roll call's chamber covers the vote date), else `unavailable` (serving, no
 * stored record). The denominator is the roll calls where both recorded yea or nay; every
 * other considered roll call is excluded under exactly one reason, the first that applies:
 * not_serving, unavailable, not_voting, present.
 */

export const DENOMINATOR_RULES = ['both_recorded_yea_or_nay'] as const;
export const DenominatorRuleSchema = z
  .enum(DENOMINATOR_RULES)
  .describe(
    'both_recorded_yea_or_nay: the denominator counts roll calls where both members recorded yea or nay; agreed = same position',
  );

export const EXCLUSION_REASONS = ['not_serving', 'unavailable', 'not_voting', 'present'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const AGREEMENT_OUTCOMES = ['agreed', 'disagreed', 'excluded'] as const;
export type AgreementOutcome = (typeof AGREEMENT_OUTCOMES)[number];

export const ExclusionCountsSchema = z
  .object({
    total: z.int().min(0),
    notServing: z.int().min(0).describe('One member held no seat in that chamber on the vote date'),
    unavailable: z
      .int()
      .min(0)
      .describe('One member was serving in that chamber but has no stored record'),
    notVoting: z.int().min(0).describe('One member is recorded as not voting'),
    present: z.int().min(0).describe('One member is recorded as present'),
  })
  .describe(
    'Considered roll calls left out of the denominator. Each counts once, under the first reason that applies: notServing, unavailable, notVoting, present',
  );
export type ExclusionCounts = z.infer<typeof ExclusionCountsSchema>;

export const VotesPeriodBasisSchema = z.enum(['all_loaded', 'congress']);

export const VotesPeriodSchema = z
  .object({
    basis: VotesPeriodBasisSchema.describe(
      'all_loaded = every loaded roll call (v1 default); congress = only that Congress',
    ),
    congress: CongressSchema.nullable(),
    firstVoteDate: IsoDateSchema.nullable().describe(
      'Earliest considered roll call (one with a stored position of a compared member); null when none',
    ),
    lastVoteDate: IsoDateSchema.nullable(),
  })
  .describe('The roll calls the agreement is computed over');
export type VotesPeriod = z.infer<typeof VotesPeriodSchema>;

const STORED = new Set<string>(VOTE_POSITIONS);
const RECORDED = new Set<string>(['yea', 'nay']);

export function classifyPair(
  a: MemberVoteState,
  b: MemberVoteState,
): { outcome: AgreementOutcome; reason: ExclusionReason | null } {
  if (RECORDED.has(a) && RECORDED.has(b)) {
    return { outcome: a === b ? 'agreed' : 'disagreed', reason: null };
  }
  const reason = EXCLUSION_REASONS.find((r) => a === r || b === r) ?? null;
  return { outcome: 'excluded', reason };
}

export interface RollcallStates {
  rollcallId: number;
  voteDate: string;
  /** personId -> state, for every requested person. */
  states: Map<number, MemberVoteState>;
}

/**
 * Every roll call (in `congress`, or all loaded) where at least one of `personIds` has a
 * stored position, with each person's state. Newest first: vote date desc, roll call id desc.
 */
export async function memberStates(
  db: Db,
  personIds: readonly number[],
  congress: number | null,
): Promise<RollcallStates[]> {
  if (personIds.length === 0) return [];
  const ids = [...personIds];
  const universe = db.$with('universe').as(
    db
      .selectDistinct({ rollcallId: votePosition.rollcallId })
      .from(votePosition)
      .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
      .where(
        and(
          inArray(votePosition.personId, ids),
          congress === null ? undefined : eq(rollcall.congress, congress),
        ),
      ),
  );
  const vt = voteTimeTerm(db, person.id);
  const rows = await db
    .with(universe)
    .select({
      rollcallId: rollcall.id,
      voteDate: rollcall.voteDate,
      personId: person.id,
      position: votePosition.position,
      serving: servingInChamber(vt),
    })
    .from(universe)
    .innerJoin(rollcall, eq(rollcall.id, universe.rollcallId))
    .innerJoin(person, inArray(person.id, ids))
    .leftJoin(
      votePosition,
      and(eq(votePosition.rollcallId, rollcall.id), eq(votePosition.personId, person.id)),
    )
    .leftJoinLateral(vt, sql`true`)
    .orderBy(desc(rollcall.voteDate), desc(rollcall.id), asc(person.id));

  const result: RollcallStates[] = [];
  for (const row of rows) {
    let last = result.at(-1);
    if (!last || last.rollcallId !== row.rollcallId) {
      last = { rollcallId: row.rollcallId, voteDate: row.voteDate, states: new Map() };
      result.push(last);
    }
    last.states.set(row.personId, memberVoteState(row.position, row.serving));
  }
  return result;
}

export interface PairRow {
  rollcallId: number;
  voteDate: string;
  a: MemberVoteState;
  b: MemberVoteState;
  outcome: AgreementOutcome;
  reason: ExclusionReason | null;
}

/** The considered roll calls for one pair (at least one of them has a stored position). */
export function pairRows(rollcalls: readonly RollcallStates[], a: number, b: number): PairRow[] {
  const rows: PairRow[] = [];
  for (const rc of rollcalls) {
    const sa = rc.states.get(a);
    const sb = rc.states.get(b);
    if (!sa || !sb || !(STORED.has(sa) || STORED.has(sb))) continue;
    rows.push({
      rollcallId: rc.rollcallId,
      voteDate: rc.voteDate,
      a: sa,
      b: sb,
      ...classifyPair(sa, sb),
    });
  }
  return rows;
}

export interface PairTotals {
  considered: number;
  shared: number;
  agreed: number;
  disagreed: number;
  excluded: ExclusionCounts;
}

const REASON_KEY = {
  not_serving: 'notServing',
  unavailable: 'unavailable',
  not_voting: 'notVoting',
  present: 'present',
} as const;

export function pairTotals(rows: readonly PairRow[]): PairTotals {
  const excluded: ExclusionCounts = {
    total: 0,
    notServing: 0,
    unavailable: 0,
    notVoting: 0,
    present: 0,
  };
  let agreed = 0;
  let disagreed = 0;
  for (const row of rows) {
    if (row.outcome === 'agreed') agreed++;
    else if (row.outcome === 'disagreed') disagreed++;
    else {
      excluded.total++;
      if (row.reason) excluded[REASON_KEY[row.reason]]++;
    }
  }
  return { considered: rows.length, shared: agreed + disagreed, agreed, disagreed, excluded };
}

export const agreementRate = (t: { agreed: number; shared: number }) =>
  t.shared > 0 ? t.agreed / t.shared : null;

export function votesPeriod(
  congress: number | null,
  rollcalls: readonly { voteDate: string }[],
): VotesPeriod {
  // Rows are newest first.
  return {
    basis: congress === null ? 'all_loaded' : 'congress',
    congress,
    firstVoteDate: rollcalls.at(-1)?.voteDate ?? null,
    lastVoteDate: rollcalls[0]?.voteDate ?? null,
  };
}

/** Congresses with a stored position of any of `personIds`, newest first. */
export async function congressesWithVotes(
  db: Db,
  personIds: readonly number[],
): Promise<Array<{ personId: number; congress: number }>> {
  if (personIds.length === 0) return [];
  return db
    .selectDistinct({ personId: votePosition.personId, congress: rollcall.congress })
    .from(votePosition)
    .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
    .where(inArray(votePosition.personId, [...personIds]))
    .orderBy(desc(rollcall.congress), asc(votePosition.personId));
}

export const uniqueDesc = (values: Iterable<number>) => [...new Set(values)].sort((x, y) => y - x);

// people.agreement@1 ---------------------------------------------------------

export const AGREEMENT_FILTERS = ['all', 'agreed', 'disagreed', 'excluded'] as const;

export const PeopleAgreementInput = z
  .strictObject({
    a: SlugSchema,
    b: SlugSchema,
    congress: CongressSchema.optional().describe(
      'Only roll calls of this Congress; omitted = all loaded roll calls (as people.compare)',
    ),
    filter: z
      .enum(AGREEMENT_FILTERS)
      .default('all')
      .describe('all considered roll calls, or only agreed / disagreed / excluded ones'),
    ...PaginationInput,
  })
  .refine((input) => input.a !== input.b, { message: 'a and b must differ', path: ['b'] });

export const PeopleAgreementOutput = z.object({
  a: PersonRefSchema,
  b: PersonRefSchema,
  period: VotesPeriodSchema,
  availableCongresses: z
    .array(CongressSchema)
    .describe('Congresses where either member has a stored position, newest first'),
  denominatorRule: DenominatorRuleSchema,
  filter: z.enum(AGREEMENT_FILTERS),
  totals: z
    .object({
      considered: z
        .int()
        .min(0)
        .describe('Roll calls in the period where either has a stored position'),
      shared: z
        .int()
        .min(0)
        .describe('Both recorded yea or nay; equals people.compare sharedVotes'),
      agreed: z.int().min(0),
      disagreed: z.int().min(0),
      excluded: ExclusionCountsSchema,
    })
    .describe('For the whole period, independent of filter and page'),
  rate: ShareSchema.nullable().describe('agreed / shared; null when nothing is shared'),
  items: z.array(
    z.object({
      rollcall: RollcallRefSchema,
      bill: BillRefSchema.nullable().describe('The bill acted on (final passage link first)'),
      states: z.object({ a: MemberVoteStateSchema, b: MemberVoteStateSchema }),
      outcome: z.enum(AGREEMENT_OUTCOMES),
      exclusionReason: z.enum(EXCLUSION_REASONS).nullable(),
    }),
  ),
  ...PageSchema,
});

export const peopleAgreement = defineCapability({
  name: 'people.agreement',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'The roll calls behind one pair’s vote agreement: each member’s state, agreed / disagreed / excluded, newest first.',
  input: PeopleAgreementInput,
  output: PeopleAgreementOutput,
  async handler({ db }, input) {
    const people = await db
      .select({ id: person.id, slug: person.slug, fullName: person.fullName })
      .from(person)
      .where(inArray(person.slug, [input.a, input.b]));
    const find = (slug: string) => people.find((p) => p.slug === slug);
    const a = find(input.a);
    const b = find(input.b);
    const missing = [input.a, input.b].filter((slug) => !find(slug));
    if (!a || !b) throw notFound(`No person with slug: ${missing.join(', ')}`);

    const congress = input.congress ?? null;
    const [rollcalls, congresses] = await Promise.all([
      memberStates(db, [a.id, b.id], congress),
      congressesWithVotes(db, [a.id, b.id]),
    ]);
    const rows = pairRows(rollcalls, a.id, b.id);
    const totals = pairTotals(rows);
    const filtered =
      input.filter === 'all' ? rows : rows.filter((row) => row.outcome === input.filter);
    const page = filtered.slice(input.offset, input.offset + input.limit);
    const ids = page.map((row) => row.rollcallId);
    const [refs, bills] = await Promise.all([rollcallRefs(db, ids), billsFor(db, ids)]);

    return {
      a: { slug: a.slug, fullName: a.fullName },
      b: { slug: b.slug, fullName: b.fullName },
      period: votesPeriod(congress, rows),
      availableCongresses: uniqueDesc(congresses.map((c) => c.congress)),
      denominatorRule: 'both_recorded_yea_or_nay' as const,
      filter: input.filter,
      totals,
      rate: agreementRate(totals),
      items: page.flatMap((row) => {
        const ref = refs.get(row.rollcallId);
        if (!ref) return [];
        return [
          {
            rollcall: ref,
            bill: bills.get(row.rollcallId) ?? null,
            states: { a: row.a, b: row.b },
            outcome: row.outcome,
            exclusionReason: row.reason,
          },
        ];
      }),
      total: filtered.length,
      limit: input.limit,
      offset: input.offset,
    };
  },
});

async function rollcallRefs(db: Db, ids: number[]) {
  if (ids.length === 0) return new Map<number, z.infer<typeof RollcallRefSchema>>();
  const rows = await db
    .select({
      id: rollcall.id,
      congress: rollcall.congress,
      chamber: rollcall.chamber,
      number: rollcall.number,
      session: rollcall.session,
      clerkNumber: rollcall.clerkNumber,
      voteDate: rollcall.voteDate,
      question: rollcall.question,
      result: rollcall.result,
    })
    .from(rollcall)
    .where(inArray(rollcall.id, ids));
  return new Map(rows.map(({ id, ...ref }) => [id, ref]));
}

/**
 * The bill each roll call acted on: a final-passage link first, then the lowest bill id.
 * Same rule as `votes.list` (whose helper is private to votes.ts).
 */
async function billsFor(db: Db, ids: number[]) {
  const result = new Map<number, z.infer<typeof BillRefSchema>>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      rollcallId: rollcallBill.rollcallId,
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      title: bill.title,
      url: bill.url,
    })
    .from(rollcallBill)
    .innerJoin(bill, eq(bill.id, rollcallBill.billId))
    .where(inArray(rollcallBill.rollcallId, ids))
    .orderBy(desc(rollcallBill.isFinalPassage), asc(bill.id));
  for (const { rollcallId, ...ref } of rows) {
    if (!result.has(rollcallId)) result.set(rollcallId, ref);
  }
  return result;
}
