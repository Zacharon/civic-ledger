import {
  candidacy,
  candidateCycleTotals,
  type Db,
  ideologyScore,
  office,
  person,
  personCard,
  personIdentifier,
  platformPosition,
  policyArea,
  term,
} from '@civic-ledger/db';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type CapabilityContext, defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  CentsSchema,
  ChamberSchema,
  CongressSchema,
  CycleSchema,
  IsoDateSchema,
  PageSchema,
  PaginationInput,
  PartySchema,
  PolicyAreaRefSchema,
  ProvenanceSchema,
  ShareSchema,
  SlugSchema,
  StateCodeSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';
import {
  agreementRate,
  congressesWithVotes,
  DenominatorRuleSchema,
  ExclusionCountsSchema,
  memberStates,
  pairRows,
  pairTotals,
  type RollcallStates,
  uniqueDesc,
  VotesPeriodSchema,
  votesPeriod,
} from './agreement';
import { moneySummary } from './money';
import {
  containsPattern,
  countCards,
  findCard,
  MemberScopeSchema,
  type PersonCardRow,
  PersonCardRowSchema,
  PersonSummarySchema,
  personSummaryColumns,
  scopeWhere,
  selectCards,
} from './person-card';

// people.search@1 ------------------------------------------------------------

export const PeopleSearchInput = z.strictObject({
  q: z.string().trim().min(1).max(100).optional().describe('Name contains (case-insensitive)'),
  scope: MemberScopeSchema.default('all').describe(
    'Default all: search finds former members too; each item says whether it is current',
  ),
  chamber: ChamberSchema.optional(),
  state: StateCodeSchema.optional(),
  party: PartySchema.optional(),
  ...PaginationInput,
});

export const PeopleSearchOutput = z.object({
  items: z.array(PersonSummarySchema),
  ...PageSchema,
});

export const peopleSearch = defineCapability({
  name: 'people.search',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Find current and former members by name, chamber, state or party. Ordered by name; current members first.',
  input: PeopleSearchInput,
  output: PeopleSearchOutput,
  async handler({ db }, input) {
    const where = and(
      scopeWhere(input.scope),
      input.q ? ilike(personCard.fullName, containsPattern(input.q)) : undefined,
      input.chamber ? eq(personCard.chamber, input.chamber) : undefined,
      input.state ? eq(personCard.state, input.state) : undefined,
      input.party ? eq(personCard.party, input.party) : undefined,
    );
    const [items, total] = await Promise.all([
      db
        .select(personSummaryColumns)
        .from(personCard)
        .where(where)
        .orderBy(
          sql`${personSummaryColumns.isCurrent} desc`,
          asc(personCard.sortName),
          asc(personCard.personId),
        )
        .limit(input.limit)
        .offset(input.offset),
      countCards(db, where),
    ]);
    return { items, total, limit: input.limit, offset: input.offset };
  },
});

// people.get@1 ---------------------------------------------------------------

const SeatSchema = z.object({
  chamber: ChamberSchema,
  state: StateCodeSchema,
  district: z.int().nullable(),
  party: PartySchema,
});

export const PeopleGetInput = z.strictObject({ slug: SlugSchema });

export const PeopleGetOutput = z.object({
  person: z.object({
    slug: SlugSchema,
    fullName: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    birthDate: IsoDateSchema.nullable(),
    provenance: ProvenanceSchema,
  }),
  card: PersonCardRowSchema,
  identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })),
  terms: z.array(
    SeatSchema.extend({
      startDate: IsoDateSchema,
      endDate: IsoDateSchema.nullable(),
      provenance: ProvenanceSchema,
    }),
  ),
  candidacies: z.array(
    SeatSchema.extend({
      cycle: CycleSchema,
      outcome: z.enum(['won', 'lost', 'withdrew', 'pending']).nullable(),
      fecCandidateId: z.string().nullable(),
      provenance: ProvenanceSchema,
    }),
  ),
  platform: z.array(
    z.object({
      cycle: CycleSchema,
      policyArea: PolicyAreaRefSchema,
      stance: z.string(),
      sourceUrl: z.url(),
      provenance: ProvenanceSchema,
    }),
  ),
});

export const peopleGet = defineCapability({
  name: 'people.get',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Profile header: identity, current card, terms, campaigns and stated platform.',
  input: PeopleGetInput,
  output: PeopleGetOutput,
  async handler({ db }, { slug }) {
    const [row] = await db
      .select({
        id: person.id,
        slug: person.slug,
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        birthDate: person.birthDate,
        ...provenanceFields(person),
      })
      .from(person)
      .where(eq(person.slug, slug))
      .limit(1);
    const card = await findCard(db, slug);
    if (!row || !card) throw notFound(`No person with slug "${slug}"`);

    const seat = {
      chamber: office.chamber,
      state: office.state,
      district: office.district,
    };
    const [identifiers, terms, candidacies, platform] = await Promise.all([
      db
        .select({ scheme: personIdentifier.scheme, value: personIdentifier.value })
        .from(personIdentifier)
        .where(eq(personIdentifier.personId, row.id))
        .orderBy(personIdentifier.scheme),
      db
        .select({
          ...seat,
          party: term.party,
          startDate: term.startDate,
          endDate: term.endDate,
          ...provenanceFields(term),
        })
        .from(term)
        .innerJoin(office, eq(office.id, term.officeId))
        .where(eq(term.personId, row.id))
        .orderBy(desc(term.startDate)),
      db
        .select({
          ...seat,
          party: candidacy.party,
          cycle: candidacy.cycle,
          outcome: candidacy.outcome,
          fecCandidateId: candidacy.fecCandidateId,
          ...provenanceFields(candidacy),
        })
        .from(candidacy)
        .innerJoin(office, eq(office.id, candidacy.officeId))
        .where(eq(candidacy.personId, row.id))
        .orderBy(desc(candidacy.cycle)),
      db
        .select({
          cycle: platformPosition.cycle,
          policyAreaId: policyArea.id,
          policyAreaName: policyArea.name,
          stance: platformPosition.stance,
          sourceUrl: platformPosition.sourceUrl,
          ...provenanceFields(platformPosition),
        })
        .from(platformPosition)
        .innerJoin(policyArea, eq(policyArea.id, platformPosition.policyAreaId))
        .where(eq(platformPosition.personId, row.id))
        .orderBy(desc(platformPosition.cycle), asc(policyArea.name)),
    ]);

    const { id: _id, ...personFields } = row;
    return {
      person: withProvenance(personFields),
      card: card.row,
      identifiers,
      terms: terms.map(withProvenance),
      candidacies: candidacies.map(withProvenance),
      platform: platform.map(withProvenance).map(({ policyAreaId, policyAreaName, ...p }) => ({
        ...p,
        policyArea: { id: policyAreaId, name: policyAreaName },
      })),
    };
  },
});

// people.compare@1 -----------------------------------------------------------

const PeriodStatusSchema = z
  .enum(['available', 'unavailable'])
  .describe(
    'unavailable = no data for this member in the period shown; values are null, never zero and never taken from another period',
  );

const MoneyPeriodValuesSchema = z
  .object({
    status: PeriodStatusSchema,
    cycle: CycleSchema.nullable().describe(
      'FEC cycle of these values: the selected cycle, or the member’s latest (null = none on record)',
    ),
    coverageEndDate: IsoDateSchema.nullable().describe(
      'Coverage end of the FEC totals (weball) behind totalReceiptsCents and pacShare',
    ),
    totalReceiptsCents: CentsSchema.nullable(),
    pacShare: ShareSchema.nullable(),
    smallDollarShare: ShareSchema.nullable(),
    smallDollarAsOf: IsoDateSchema.nullable().describe(
      'Coverage end of the FEC candidate summary behind smallDollarShare (can trail coverageEndDate)',
    ),
    topIndustries: PersonCardRowSchema.shape.topIndustries.nullable(),
    industryCodingCoverage: ShareSchema.nullable(),
    outsideSupportCents: CentsSchema.nullable(),
    outsideOpposeCents: CentsSchema.nullable(),
  })
  .describe('Same rules as the card and money.summary (DECISIONS A15, A29, A31)');

const IdeologyPeriodValuesSchema = z.object({
  status: PeriodStatusSchema,
  congress: CongressSchema.nullable().describe(
    'Congress of the DW-NOMINATE estimate: the selected one, or the member’s latest',
  ),
  dim1: z.number().nullable(),
  dim2: z.number().nullable(),
});

const VotesPeriodValuesSchema = z.object({
  status: PeriodStatusSchema,
  congress: CongressSchema.nullable().describe(
    'Congress of votesEligible / missedVoteRate: the selected one, or the member’s latest with stored positions',
  ),
  votesEligible: z.int().nullable().describe('Stored positions in that Congress'),
  missedVoteRate: ShareSchema.nullable().describe('not_voting / votesEligible'),
});

export const PeopleCompareInput = z.strictObject({
  slugs: z
    .array(SlugSchema)
    .min(2)
    .max(4)
    .refine((slugs) => new Set(slugs).size === slugs.length, 'Slugs must be distinct'),
  congress: CongressSchema.optional().describe(
    'Compare votes (agreement, missed votes) and DW-NOMINATE for this Congress only. Omitted = all loaded roll calls and each member’s latest values (v1)',
  ),
  cycle: CycleSchema.optional().describe(
    'Money values for this FEC cycle. Omitted = each member’s latest cycle (v1)',
  ),
});

export const PeopleCompareOutput = z.object({
  people: z
    .array(PersonCardRowSchema)
    .describe('In input order. Cards always carry each member’s latest values; see periodValues'),
  period: z
    .object({
      votes: VotesPeriodSchema,
      money: z.object({
        basis: z
          .enum(['latest_per_person', 'cycle'])
          .describe('latest_per_person = each member’s own latest cycle, which can differ'),
        cycle: CycleSchema.nullable(),
      }),
      ideology: z.object({
        basis: z.enum(['latest_per_person', 'congress']),
        congress: CongressSchema.nullable(),
      }),
    })
    .describe('The period the comparison was computed for'),
  availablePeriods: z
    .object({
      congresses: z
        .array(CongressSchema)
        .describe('Congresses where any compared member has a stored position, newest first'),
      cycles: z
        .array(CycleSchema)
        .describe('FEC cycles with totals for any compared member, newest first'),
    })
    .describe('Choices for the congress / cycle inputs'),
  periodValues: z
    .array(
      z.object({
        slug: SlugSchema,
        money: MoneyPeriodValuesSchema,
        ideology: IdeologyPeriodValuesSchema,
        votes: VotesPeriodValuesSchema,
      }),
    )
    .describe(
      'Per member, in input order: the values shown for the period, each with its own period',
    ),
  voteAgreement: z
    .array(
      z.object({
        a: SlugSchema,
        b: SlugSchema,
        sharedVotes: z.int().describe('Rollcalls where both voted yea or nay'),
        agreed: z.int(),
        rate: ShareSchema.nullable(),
        disagreed: z.int().describe('sharedVotes - agreed'),
        denominatorRule: DenominatorRuleSchema,
        excluded: ExclusionCountsSchema,
      }),
    )
    .describe(
      'Pairwise agreement on recorded yea/nay votes in period.votes; people.agreement lists the roll calls',
    ),
});

export const peopleCompare = defineCapability({
  name: 'people.compare',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Two to four people side by side, with pairwise yea/nay vote agreement; optionally for one Congress and one FEC cycle.',
  input: PeopleCompareInput,
  output: PeopleCompareOutput,
  async handler(ctx, { slugs, congress: congressInput, cycle: cycleInput }) {
    const { db } = ctx;
    const cards = await selectCards(db, { where: inArray(personCard.slug, slugs) });
    const missing = slugs.filter((slug) => !cards.some((c) => c.slug === slug));
    if (missing.length > 0) throw notFound(`No person with slug: ${missing.join(', ')}`);

    const ids = await personIdsBySlug(db, slugs);
    const idOf = (slug: string) => ids.get(slug) ?? 0;
    const personIds = slugs.map(idOf);
    const congress = congressInput ?? null;
    const cycle = cycleInput ?? null;
    const [rollcalls, voteCongresses, totals, ideology] = await Promise.all([
      memberStates(db, personIds, congress),
      congressesWithVotes(db, personIds),
      totalsByCycle(db, personIds),
      congress === null ? null : ideologyFor(db, personIds, congress),
    ]);

    const voteAgreement = slugs.flatMap((a, i) =>
      slugs.slice(i + 1).map((b) => {
        const t = pairTotals(pairRows(rollcalls, idOf(a), idOf(b)));
        return {
          a,
          b,
          sharedVotes: t.shared,
          agreed: t.agreed,
          rate: agreementRate(t),
          disagreed: t.disagreed,
          denominatorRule: 'both_recorded_yea_or_nay' as const,
          excluded: t.excluded,
        };
      }),
    );

    const people = slugs.flatMap((slug) => cards.filter((c) => c.slug === slug));
    const periodValues = await Promise.all(
      people.map(async (card) => {
        const id = idOf(card.slug);
        let money: MoneyPeriodValues;
        if (cycle === null) {
          money = latestMoney(card, totals.get(`${id}:${card.moneyCycle}`) ?? null);
        } else if (totals.has(`${id}:${cycle}`)) {
          money = await cycleMoney(ctx, card.slug, cycle);
        } else {
          money = unavailableMoney(cycle);
        }
        return {
          slug: card.slug,
          money,
          ideology: ideology === null ? latestIdeology(card) : ideologyIn(ideology, id, congress),
          votes:
            congress === null
              ? latestVotes(card, voteCongresses.find((v) => v.personId === id)?.congress ?? null)
              : votesIn(rollcalls, id, congress),
        };
      }),
    );

    const moneyBasis: 'latest_per_person' | 'cycle' =
      cycle === null ? 'latest_per_person' : 'cycle';
    const ideologyBasis: 'latest_per_person' | 'congress' =
      congress === null ? 'latest_per_person' : 'congress';
    return {
      people,
      period: {
        votes: votesPeriod(congress, rollcalls),
        money: { basis: moneyBasis, cycle },
        ideology: { basis: ideologyBasis, congress },
      },
      availablePeriods: {
        congresses: uniqueDesc(voteCongresses.map((v) => v.congress)),
        cycles: uniqueDesc([...totals.values()].map((t) => t.cycle)),
      },
      periodValues,
      voteAgreement,
    };
  },
});

async function personIdsBySlug(db: Db, slugs: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: person.id, slug: person.slug })
    .from(person)
    .where(inArray(person.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

type MoneyPeriodValues = z.infer<typeof MoneyPeriodValuesSchema>;
type IdeologyPeriodValues = z.infer<typeof IdeologyPeriodValuesSchema>;
type VotesPeriodValues = z.infer<typeof VotesPeriodValuesSchema>;

/** FEC totals rows per `personId:cycle` (the largest if several, as money.summary picks). */
async function totalsByCycle(db: Db, personIds: number[]) {
  const t = candidateCycleTotals;
  const rows = await db
    .select({ personId: t.personId, cycle: t.cycle, coverageEndDate: t.coverageEndDate })
    .from(t)
    .where(inArray(t.personId, personIds))
    .orderBy(desc(t.cycle), desc(t.totalReceiptsCents));
  const result = new Map<string, { cycle: number; coverageEndDate: string | null }>();
  for (const row of rows) {
    const key = `${row.personId}:${row.cycle}`;
    if (!result.has(key)) {
      result.set(key, { cycle: row.cycle, coverageEndDate: row.coverageEndDate });
    }
  }
  return result;
}

/** v1 default: the card's own latest-cycle values, plus the totals' coverage end. */
function latestMoney(
  card: PersonCardRow,
  totals: { coverageEndDate: string | null } | null,
): MoneyPeriodValues {
  if (card.moneyCycle === null) return unavailableMoney(null);
  return {
    status: 'available',
    cycle: card.moneyCycle,
    coverageEndDate: totals?.coverageEndDate ?? null,
    totalReceiptsCents: card.totalReceiptsCents,
    pacShare: card.pacShare,
    smallDollarShare: card.smallDollarShare,
    smallDollarAsOf: card.smallDollarAsOf,
    topIndustries: card.topIndustries,
    industryCodingCoverage: card.industryCodingCoverage,
    outsideSupportCents: card.outsideSupportCents,
    outsideOpposeCents: card.outsideOpposeCents,
  };
}

/**
 * One cycle's card money values, derived from money.summary itself so the rules (A15
 * attribution, A29 gross-based coverage and net-positive top industries, A31 small-dollar
 * share from the candidate summary) cannot drift from the profile's Money section.
 */
async function cycleMoney(
  ctx: CapabilityContext,
  slug: string,
  cycle: number,
): Promise<MoneyPeriodValues> {
  const money = await moneySummary.handler(ctx, { slug, cycle });
  if (!money.totals) return unavailableMoney(cycle);
  return {
    status: 'available',
    cycle,
    coverageEndDate: money.totals.coverageEndDate ?? null,
    totalReceiptsCents: money.totals.totalReceiptsCents,
    pacShare: money.totals.pacShare ?? null,
    smallDollarShare: money.smallDollar?.share ?? null,
    smallDollarAsOf: money.smallDollar?.coverageEndDate ?? null,
    topIndustries: money.industries
      .filter((i) => i.amountCents > 0)
      .slice(0, 3)
      .map((i) => ({ id: i.industry.id, name: i.industry.name, amountCents: i.amountCents })),
    industryCodingCoverage: money.industryCoding.coverage ?? null,
    outsideSupportCents: money.outsideSpending.supportCents,
    outsideOpposeCents: money.outsideSpending.opposeCents,
  };
}

function unavailableMoney(cycle: number | null): MoneyPeriodValues {
  return {
    status: 'unavailable',
    cycle,
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
}

function latestIdeology(card: PersonCardRow): IdeologyPeriodValues {
  return {
    status: card.ideologyCongress === null ? 'unavailable' : 'available',
    congress: card.ideologyCongress,
    dim1: card.dwNominateDim1,
    dim2: card.dwNominateDim2,
  };
}

async function ideologyFor(db: Db, personIds: number[], congress: number) {
  const s = ideologyScore;
  const rows = await db
    .select({ personId: s.personId, dim1: s.dim1, dim2: s.dim2 })
    .from(s)
    .where(
      and(inArray(s.personId, personIds), eq(s.congress, congress), eq(s.method, 'dw-nominate')),
    );
  return new Map(rows.map((r) => [r.personId, r]));
}

function ideologyIn(
  scores: Map<number, { dim1: number; dim2: number | null }>,
  personId: number,
  congress: number | null,
): IdeologyPeriodValues {
  const score = scores.get(personId);
  return {
    status: score ? 'available' : 'unavailable',
    congress,
    dim1: score?.dim1 ?? null,
    dim2: score?.dim2 ?? null,
  };
}

function latestVotes(card: PersonCardRow, congress: number | null): VotesPeriodValues {
  return {
    status: card.votesEligible === null ? 'unavailable' : 'available',
    congress,
    votesEligible: card.votesEligible,
    missedVoteRate: card.missedVoteRate,
  };
}

/** The card's vote rule (stored positions; missed = not_voting) for one Congress. */
function votesIn(
  rollcalls: readonly RollcallStates[],
  personId: number,
  congress: number,
): VotesPeriodValues {
  let eligible = 0;
  let missed = 0;
  for (const rc of rollcalls) {
    const state = rc.states.get(personId);
    if (state === 'yea' || state === 'nay' || state === 'present' || state === 'not_voting') {
      eligible++;
      if (state === 'not_voting') missed++;
    }
  }
  if (eligible === 0) {
    return { status: 'unavailable', congress, votesEligible: null, missedVoteRate: null };
  }
  return {
    status: 'available',
    congress,
    votesEligible: eligible,
    missedVoteRate: missed / eligible,
  };
}
