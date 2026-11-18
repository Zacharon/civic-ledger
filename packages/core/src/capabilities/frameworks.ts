import {
  bill,
  type Db,
  framework,
  frameworkRule,
  person,
  personCard,
  rollcall,
  rollcallBill,
  votePosition,
} from '@civic-ledger/db';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import {
  ambiguousTerm,
  coversVoteDate,
  MEMBER_VOTE_STATES,
  memberVoteState,
  servingInChamber,
  voteTimeTerm,
} from '../frameworks/membership';
import { type CastVote, type RollcallClaim, scoreVotes } from '../frameworks/score';
import {
  BillTypeSchema,
  FrameworkRuleSchema,
  FrameworkSpecSchema,
  type RuleTarget,
  RuleTargetSchema,
} from '../frameworks/spec';
import {
  BillRefSchema,
  ChamberSchema,
  EmptyInputSchema,
  PageSchema,
  PartySchema,
  ProvenanceSchema,
  RollcallRefSchema,
  ShareSchema,
  SlugSchema,
  StateCodeSchema,
  VotePositionSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';
import { PersonSummarySchema, personSummaryColumns } from './person-card';

// frameworks.list@1 ----------------------------------------------------------

export const FrameworksListOutput = z.object({
  items: z.array(
    z.object({
      slug: z.string(),
      version: z.int(),
      title: z.string(),
      author: z.string(),
      statedOrientation: z.string().describe("The framework author's own stated orientation"),
      description: z.string(),
      methodologyUrl: z.url().nullable(),
      provenance: ProvenanceSchema,
      spec: FrameworkSpecSchema.describe('Pass as `framework` to frameworks.evaluate'),
    }),
  ),
});

export const frameworksList = defineCapability({
  name: 'frameworks.list',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Pre-built, attributed frameworks with their full rule specs.',
  input: EmptyInputSchema,
  output: FrameworksListOutput,
  async handler({ db }) {
    const frameworks = await db
      .select({
        id: framework.id,
        slug: framework.slug,
        version: framework.version,
        title: framework.title,
        author: framework.author,
        statedOrientation: framework.statedOrientation,
        description: framework.description,
        methodologyUrl: framework.methodologyUrl,
        ...provenanceFields(framework),
      })
      .from(framework)
      .orderBy(asc(framework.title), asc(framework.version));
    const rules = await db
      .select({
        frameworkId: frameworkRule.frameworkId,
        alignedPosition: frameworkRule.alignedPosition,
        weight: frameworkRule.weight,
        rationale: frameworkRule.rationale,
        rollcall: {
          congress: rollcall.congress,
          chamber: rollcall.chamber,
          number: rollcall.number,
        },
        bill: { congress: bill.congress, billType: bill.billType, number: bill.number },
      })
      .from(frameworkRule)
      .leftJoin(rollcall, eq(rollcall.id, frameworkRule.rollcallId))
      .leftJoin(bill, eq(bill.id, frameworkRule.billId))
      .orderBy(asc(frameworkRule.id));

    return {
      items: frameworks.map(({ id, ...f }) => ({
        ...withProvenance(f),
        spec: {
          title: f.title,
          rules: rules
            .filter((r) => r.frameworkId === id)
            .map((r) => ({
              target: toTarget(r.rollcall, r.bill),
              alignedPosition: r.alignedPosition,
              weight: r.weight,
              ...(r.rationale ? { rationale: r.rationale } : {}),
            })),
        },
      })),
    };
  },
});

function toTarget(
  rc: { congress: number; chamber: 'house' | 'senate'; number: number } | null,
  b: { congress: number; billType: string; number: number } | null,
): RuleTarget {
  if (rc) return { kind: 'rollcall', ...rc };
  if (b)
    return {
      kind: 'bill',
      congress: b.congress,
      billType: BillTypeSchema.parse(b.billType),
      number: b.number,
    };
  throw new Error('framework_rule has neither a rollcall nor a bill');
}

// frameworks.evaluate@1 ------------------------------------------------------

const UNRESOLVED_REASONS = [
  'rollcall_not_found',
  'bill_not_found',
  'no_final_passage_vote',
  'duplicate_rollcall',
] as const;

export { MEMBER_VOTE_STATES, type MemberVoteState } from '../frameworks/membership';
export const MemberVoteStateSchema = z.enum(MEMBER_VOTE_STATES);

const PEOPLE_BASES = ['current', 'at_vote'] as const;

export const FrameworksEvaluateInput = z.strictObject({
  framework: FrameworkSpecSchema,
  people: z
    .strictObject({
      slugs: z.array(SlugSchema).min(1).max(600).optional(),
      chamber: ChamberSchema.optional(),
      state: StateCodeSchema.optional(),
      party: PartySchema.optional(),
      basis: z
        .enum(PEOPLE_BASES)
        .default('current')
        .describe(
          "What chamber/state/party are matched against. 'current' (default, v1): the person's latest term, i.e. people currently in that chamber/state/party, with all their votes. 'at_vote': the member's term for each rollcall (a term in the roll call's chamber only: one covering the vote date (end date exclusive; latest start, then highest id), else one whose recorded end is at most 2 days before the vote; else unattributed); a vote is kept only if cast while in that chamber/state/party (historical membership); an unattributed vote matches no chamber/state/party filter.",
        ),
    })
    .default({ basis: 'current' })
    .describe('Who to score; default everyone with a recorded vote on a resolved rollcall'),
  limit: z.int().min(1).max(600).default(100),
  offset: z.int().min(0).default(0),
});

const RollcallKeySchema = RollcallRefSchema.pick({
  congress: true,
  chamber: true,
  number: true,
  session: true,
  clerkNumber: true,
});

export const FrameworksEvaluateOutput = z.object({
  framework: z.object({ title: z.string(), ruleCount: z.int() }),
  peopleBasis: z
    .enum(PEOPLE_BASES)
    .describe('The basis the people filters were applied on (input `people.basis`)'),
  rules: z.array(
    z.object({
      ruleIndex: z.int(),
      target: RuleTargetSchema,
      alignedPosition: FrameworkRuleSchema.shape.alignedPosition,
      weight: z.number(),
      status: z.enum(['resolved', 'unresolved']),
      reason: z.enum(UNRESOLVED_REASONS).nullable(),
      bill: BillRefSchema.nullable(),
      rollcalls: z.array(RollcallRefSchema).describe('Exactly the rollcalls this rule scored'),
    }),
  ),
  results: z.array(
    z.object({
      person: PersonSummarySchema,
      aligned: z.int().describe('X in "aligned X of Y"'),
      considered: z.int().describe('Y: rollcalls where the person voted yea or nay'),
      notCounted: z.int().describe('Present or not voting; excluded from X and Y'),
      alignmentRate: ShareSchema.nullable(),
      weightedAligned: z.number(),
      weightedConsidered: z.number(),
      votes: z.array(
        z.object({
          ruleIndex: z.int(),
          rollcall: RollcallKeySchema,
          position: VotePositionSchema,
          aligned: z.boolean().nullable(),
        }),
      ),
      rollcallStates: z
        .array(
          z.object({
            ruleIndex: z.int(),
            rollcall: RollcallKeySchema,
            state: MemberVoteStateSchema.describe(
              'The stored position; with none stored, not_serving (no term in an office of the rollcall chamber covers the vote date) or unavailable (serving per the terms, but no stored record)',
            ),
            partyAtVote: z
              .string()
              .nullable()
              .describe(
                "Party on the member's term at the vote date, resolved as votes.list byParty resolves it (a term in the roll call's chamber only: one covering the vote date (end date exclusive; latest start, then highest id), else one whose recorded end is at most 2 days before the vote; else unattributed). The grace-window term applies to a recorded vote only. Null when the vote is unattributed, or with no vote and no covering term. `person.party` is the current (latest-term) party",
              ),
            ambiguousTerm: z
              .boolean()
              .describe(
                "More than one term in the rollcall's chamber covers the vote date; one is chosen deterministically (latest start, then highest id)",
              ),
          }),
        )
        .describe('One entry per resolved rollcall in rule order, including those with no vote'),
    }),
  ),
  ...PageSchema,
});

type RuleOutput = z.input<typeof FrameworksEvaluateOutput>['rules'][number];
type ResolvedRollcall = z.infer<typeof RollcallRefSchema> & { id: number };

export const frameworksEvaluate = defineCapability({
  name: 'frameworks.evaluate',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Score people against a framework spec: "aligned X of Y" with the exact votes used.',
  input: FrameworksEvaluateInput,
  output: FrameworksEvaluateOutput,
  async handler({ db }, input) {
    const { rules, claims, rollcallKeys } = await resolveRules(db, input.framework.rules);
    const page = { limit: input.limit, offset: input.offset };
    const frameworkSummary = {
      title: input.framework.title,
      ruleCount: input.framework.rules.length,
    };
    const peopleBasis = input.people.basis;
    if (claims.size === 0)
      return { framework: frameworkSummary, peopleBasis, rules, results: [], total: 0, ...page };

    const votes = await castVotes(db, [...claims.keys()], input.people);
    const scores = scoreVotes(claims, votes);
    const people =
      scores.size === 0
        ? []
        : await db
            .select({ personId: personCard.personId, ...personSummaryColumns })
            .from(personCard)
            .where(inArray(personCard.personId, [...scores.keys()]))
            .orderBy(asc(personCard.state), asc(personCard.sortName), asc(personCard.personId));

    const pagePeople = people.slice(input.offset, input.offset + input.limit);
    const states = await rollcallStates(
      db,
      [...claims.keys()],
      pagePeople.map((p) => p.personId),
    );
    const claimOrder = [...claims.entries()]
      .map(([rollcallId, claim]) => ({ rollcallId, ruleIndex: claim.ruleIndex }))
      .sort((a, b) => a.ruleIndex - b.ruleIndex || a.rollcallId - b.rollcallId);
    const results = pagePeople.flatMap(({ personId, ...summary }) => {
      const score = scores.get(personId);
      if (!score) return [];
      const { votes: cast, ...counts } = score;
      return [
        {
          person: summary,
          ...counts,
          alignmentRate: counts.considered > 0 ? counts.aligned / counts.considered : null,
          votes: cast.flatMap(({ rollcallId, ...v }) => {
            const rollcallKey = rollcallKeys.get(rollcallId);
            return rollcallKey ? [{ ...v, rollcall: rollcallKey }] : [];
          }),
          rollcallStates: claimOrder.flatMap(({ rollcallId, ruleIndex }) => {
            const rollcallKey = rollcallKeys.get(rollcallId);
            if (!rollcallKey) return [];
            const found = states.get(`${personId}:${rollcallId}`);
            return [
              {
                ruleIndex,
                rollcall: rollcallKey,
                state: memberVoteState(found?.position ?? null, found?.serving ?? false),
                partyAtVote: found?.party ?? null,
                ambiguousTerm: found?.ambiguous ?? false,
              },
            ];
          }),
        },
      ];
    });
    return {
      framework: frameworkSummary,
      peopleBasis,
      rules,
      results,
      total: people.length,
      ...page,
    };
  },
});

type PeopleFilter = z.output<typeof FrameworksEvaluateInput>['people'];

/**
 * Stored votes on the claimed rollcalls for the people the filter selects. On the
 * 'current' basis chamber/state/party match the person card (latest term, v1); on
 * 'at_vote' they match the member's term on each rollcall's vote date as `voteTimeTerm`
 * resolves it, the same term `votes.list` counts the vote under.
 */
async function castVotes(db: Db, rollcallIds: number[], filter: PeopleFilter): Promise<CastVote[]> {
  const { slugs, chamber, state, party, basis } = filter;
  const fields = {
    personId: votePosition.personId,
    rollcallId: votePosition.rollcallId,
    position: votePosition.position,
  };
  if (basis === 'current') {
    return db
      .select(fields)
      .from(votePosition)
      .innerJoin(personCard, eq(personCard.personId, votePosition.personId))
      .where(
        and(
          inArray(votePosition.rollcallId, rollcallIds),
          slugs ? inArray(personCard.slug, slugs) : undefined,
          chamber ? eq(personCard.chamber, chamber) : undefined,
          state ? eq(personCard.state, state) : undefined,
          party ? eq(personCard.party, party) : undefined,
        ),
      );
  }
  const vt = voteTimeTerm(db, votePosition.personId);
  return db
    .select(fields)
    .from(votePosition)
    .innerJoin(personCard, eq(personCard.personId, votePosition.personId))
    .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
    .leftJoinLateral(vt, sql`true`)
    .where(
      and(
        inArray(votePosition.rollcallId, rollcallIds),
        slugs ? inArray(personCard.slug, slugs) : undefined,
        chamber ? eq(vt.chamber, chamber) : undefined,
        state ? eq(vt.state, state) : undefined,
        party ? eq(vt.party, party) : undefined,
      ),
    );
}

/** Every (person, rollcall) pair on the page, voted or not, with its vote-time term facts. */
async function rollcallStates(db: Db, rollcallIds: number[], personIds: number[]) {
  const result = new Map<
    string,
    {
      position: CastVote['position'] | null;
      serving: boolean;
      party: string | null;
      ambiguous: boolean;
    }
  >();
  if (personIds.length === 0) return result;
  const vt = voteTimeTerm(db, person.id);
  const rows = await db
    .select({
      personId: person.id,
      rollcallId: rollcall.id,
      position: votePosition.position,
      // The vote-date party of a cast vote (fallback included, as `votes.list` counts it);
      // with no vote, only a covering term gives a vote-date party.
      party: sql<
        string | null
      >`case when ${coversVoteDate(vt)} or ${votePosition.position} is not null then ${vt.party} end`,
      serving: servingInChamber(vt),
      ambiguous: ambiguousTerm(vt),
    })
    .from(rollcall)
    .innerJoin(person, inArray(person.id, personIds))
    .leftJoin(
      votePosition,
      and(eq(votePosition.rollcallId, rollcall.id), eq(votePosition.personId, person.id)),
    )
    .leftJoinLateral(vt, sql`true`)
    .where(inArray(rollcall.id, rollcallIds));
  for (const { personId, rollcallId, ...facts } of rows)
    result.set(`${personId}:${rollcallId}`, facts);
  return result;
}

/**
 * Resolves rule targets to rollcalls. A rollcall is claimed by the first rule that
 * reaches it, so overlapping rules never double count a vote.
 */
async function resolveRules(db: Db, specRules: z.output<typeof FrameworkRuleSchema>[]) {
  const rollcallFields = {
    id: rollcall.id,
    congress: rollcall.congress,
    chamber: rollcall.chamber,
    number: rollcall.number,
    session: rollcall.session,
    clerkNumber: rollcall.clerkNumber,
    voteDate: rollcall.voteDate,
    question: rollcall.question,
    result: rollcall.result,
  };
  const rollcallTargets = specRules.flatMap((r) =>
    r.target.kind === 'rollcall' ? [r.target] : [],
  );
  const billTargets = specRules.flatMap((r) => (r.target.kind === 'bill' ? [r.target] : []));

  const [rollcallRows, billRows] = await Promise.all([
    rollcallTargets.length === 0
      ? []
      : db
          .select(rollcallFields)
          .from(rollcall)
          .where(
            or(
              ...rollcallTargets.map((t) =>
                and(
                  eq(rollcall.congress, t.congress),
                  eq(rollcall.chamber, t.chamber),
                  eq(rollcall.number, t.number),
                ),
              ),
            ),
          ),
    billTargets.length === 0
      ? []
      : db
          .select({
            bill: {
              congress: bill.congress,
              billType: bill.billType,
              number: bill.number,
              title: bill.title,
              url: bill.url,
            },
            rollcall: rollcallFields,
          })
          .from(bill)
          .leftJoin(
            rollcallBill,
            and(eq(rollcallBill.billId, bill.id), eq(rollcallBill.isFinalPassage, true)),
          )
          .leftJoin(rollcall, eq(rollcall.id, rollcallBill.rollcallId))
          .where(
            or(
              ...billTargets.map((t) =>
                and(
                  eq(bill.congress, t.congress),
                  eq(bill.billType, t.billType),
                  eq(bill.number, t.number),
                ),
              ),
            ),
          )
          .orderBy(asc(rollcall.voteDate), asc(rollcall.id)),
  ]);

  const claims = new Map<number, RollcallClaim>();
  const rollcallKeys = new Map<number, z.infer<typeof RollcallKeySchema>>();
  const rules = specRules.map((rule, ruleIndex): RuleOutput => {
    const base = {
      ruleIndex,
      target: rule.target,
      alignedPosition: rule.alignedPosition,
      weight: rule.weight,
    };
    const unresolved = (
      reason: (typeof UNRESOLVED_REASONS)[number],
      billRef: RuleOutput['bill'] = null,
    ) => ({
      ...base,
      status: 'unresolved' as const,
      reason,
      bill: billRef,
      rollcalls: [],
    });

    let found: ResolvedRollcall[];
    let billRef: RuleOutput['bill'] = null;
    const { target } = rule;
    if (target.kind === 'rollcall') {
      found = rollcallRows.filter(
        (r) =>
          r.congress === target.congress &&
          r.chamber === target.chamber &&
          r.number === target.number,
      );
      if (found.length === 0) return unresolved('rollcall_not_found');
    } else {
      const matches = billRows.filter(
        (r) =>
          r.bill.congress === target.congress &&
          r.bill.billType === target.billType &&
          r.bill.number === target.number,
      );
      billRef = matches[0]?.bill ?? null;
      if (!billRef) return unresolved('bill_not_found');
      found = matches.flatMap((m) => (m.rollcall ? [m.rollcall] : []));
      if (found.length === 0) return unresolved('no_final_passage_vote', billRef);
    }

    const claimed = found.filter((r) => !claims.has(r.id));
    if (claimed.length === 0) return unresolved('duplicate_rollcall', billRef);
    for (const { id, congress, chamber, number, session, clerkNumber } of claimed) {
      claims.set(id, { ruleIndex, alignedPosition: rule.alignedPosition, weight: rule.weight });
      rollcallKeys.set(id, { congress, chamber, number, session, clerkNumber });
    }
    return {
      ...base,
      status: 'resolved',
      reason: null,
      bill: billRef,
      rollcalls: claimed.map(({ id: _id, ...ref }) => ref),
    };
  });
  return { rules, claims, rollcallKeys };
}
