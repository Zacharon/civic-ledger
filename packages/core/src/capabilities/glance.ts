import { type Db, person, rollcall, votePosition } from '@civic-ledger/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { buildGlance, type GlanceFacts } from '../glance/text';
import {
  CentsSchema,
  ChamberSchema,
  CongressSchema,
  CycleSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  PartySchema,
  PersonRefSchema,
  ProvenanceSchema,
  ShareSchema,
  SlugSchema,
  StateCodeSchema,
} from '../schemas/common';
import { withProvenance } from '../schemas/provenance';
import { moneySummary, shareOf } from './money';
import { peopleGet } from './people';
import { promisesList } from './promises';
import { scoresList } from './scores';

const PartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({
    kind: z.literal('value'),
    fact: z.string().describe('Path in facts, using numeric array indexes'),
    value: z.union([z.number(), z.string()]).nullable(),
    text: z.string(),
  }),
  z.object({ kind: z.literal('term'), explainer: z.string(), text: z.string() }),
]);

export const PeopleGlanceInput = z.strictObject({ slug: SlugSchema });
export const PeopleGlanceOutput = z.object({
  person: PersonRefSchema,
  asOf: IsoDateTimeSchema.describe('Ledger table rebuild time; each source retains its own clock'),
  facts: z.object({
    who: z.object({
      fullName: z.string(),
      isCurrent: z.boolean(),
      chamber: ChamberSchema.nullable(),
      state: StateCodeSchema.nullable(),
      district: z.int().nullable(),
      party: PartySchema.nullable(),
      termStart: IsoDateSchema.nullable(),
      termEnd: IsoDateSchema.nullable(),
      serviceStart: IsoDateSchema.nullable(),
      tenureYears: z.number().nullable(),
      termsServed: z.int().min(0),
      provenance: ProvenanceSchema,
    }),
    money: z
      .object({
        cycle: CycleSchema,
        totalReceiptsCents: CentsSchema,
        coverageEndDate: IsoDateSchema.nullable(),
        pacShare: ShareSchema.nullable(),
        smallDollarShare: ShareSchema.nullable(),
        smallDollarAsOf: IsoDateSchema.nullable(),
        largerIndividualShare: ShareSchema.nullable(),
        topIndustries: z.array(
          z.object({ id: z.string(), name: z.string(), amountCents: CentsSchema }),
        ),
        industryCodingCoverage: ShareSchema.nullable(),
        hasPacContributions: z.boolean(),
        outsideSupportCents: CentsSchema,
        outsideOpposeCents: CentsSchema,
        outsideItems: z.int().min(0),
        provenance: ProvenanceSchema,
        smallDollarProvenance: ProvenanceSchema.nullable(),
      })
      .nullable(),
    votes: z.object({
      congress: CongressSchema.nullable(),
      votesEligible: z.int().nullable(),
      votesMissed: z.int().nullable(),
      missedVoteRate: ShareSchema.nullable(),
      provenance: ProvenanceSchema.nullable().describe(
        'Example underlying position; all records are available in Votes',
      ),
      dwNominate: z
        .object({
          congress: CongressSchema,
          dim1: z.number(),
          dim2: z.number().nullable(),
          provenance: ProvenanceSchema,
        })
        .nullable(),
    }),
    say: z.object({
      platformPositions: z.int().min(0),
      platformCycle: CycleSchema.nullable(),
      promises: z.int().min(0),
      promisesRated: z.int().min(0),
      promisesKept: z.int().min(0),
      provenance: ProvenanceSchema.nullable(),
      positions: z
        .array(
          z.object({
            cycle: CycleSchema,
            policyArea: z.string(),
            stance: z.string(),
            sourceUrl: z.url(),
            provenance: ProvenanceSchema,
          }),
        )
        .max(3),
    }),
  }),
  paragraphs: z.array(
    z.object({
      id: z.enum(['who', 'money', 'votes', 'say']),
      title: z.string(),
      detailHref: z.string().describe('Profile section with the full records and evidence'),
      sentences: z.array(
        z.object({
          id: z.string(),
          parts: z.array(PartSchema),
          text: z.string(),
          provenance: ProvenanceSchema.nullable(),
          evidenceHref: z
            .string()
            .nullable()
            .describe('Original source for a stated position, if present'),
        }),
      ),
    }),
  ),
});

export const peopleGlance = defineCapability({
  name: 'people.glance',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Deterministic sourced overview of office, campaign financing, votes and reviewed stated positions, with explicit coverage gaps and no motive judgments.',
  input: PeopleGlanceInput,
  output: PeopleGlanceOutput,
  async handler(ctx, { slug }) {
    const [profile, money, promises, scores, participation] = await Promise.all([
      peopleGet.handler(ctx, { slug }),
      moneySummary.handler(ctx, { slug }),
      promisesList.handler(ctx, { slug }),
      scoresList.handler(ctx, { slug }),
      loadParticipation(ctx.db, slug),
    ]);
    const row = profile.card;
    const totals = money.totals;
    const small = money.smallDollar;
    const ideology = scores.ideology.find((i) => i.method === 'dw-nominate') ?? null;
    const facts: GlanceFacts = {
      who: {
        fullName: row.fullName,
        isCurrent: row.isCurrent,
        chamber: row.chamber,
        state: row.state,
        district: row.district,
        party: row.party,
        termStart: row.termStart,
        termEnd: row.termEnd,
        serviceStart: row.serviceStart,
        tenureYears: row.tenureYears,
        termsServed: profile.terms.length,
        provenance: profile.terms[0]?.provenance ?? profile.person.provenance,
      },
      money:
        money.cycle === null || !totals
          ? null
          : {
              cycle: money.cycle,
              totalReceiptsCents: totals.totalReceiptsCents,
              coverageEndDate: totals.coverageEndDate,
              pacShare: totals.pacShare,
              smallDollarShare: small?.share ?? null,
              smallDollarAsOf: small?.coverageEndDate ?? null,
              largerIndividualShare: small
                ? shareOf(small.itemizedIndividualCents, small.totalReceiptsCents)
                : null,
              topIndustries: money.industries
                .filter((i) => i.amountCents > 0)
                .slice(0, 3)
                .map((i) => ({
                  id: i.industry.id,
                  name: i.industry.name,
                  amountCents: i.amountCents,
                })),
              industryCodingCoverage: money.industryCoding.coverage,
              hasPacContributions: money.industryCoding.grossCents > 0,
              outsideSupportCents: money.outsideSpending.supportCents,
              outsideOpposeCents: money.outsideSpending.opposeCents,
              outsideItems: money.outsideSpending.itemCount,
              provenance: totals.provenance,
              smallDollarProvenance: small?.provenance ?? null,
            },
      votes: {
        ...participation,
        dwNominate: ideology
          ? {
              congress: ideology.congress,
              dim1: ideology.dim1,
              dim2: ideology.dim2,
              provenance: ideology.provenance,
            }
          : null,
      },
      say: {
        platformPositions: profile.platform.length,
        platformCycle: profile.platform[0]?.cycle ?? null,
        promises: promises.summary.total,
        promisesRated: promises.summary.rated,
        promisesKept: promises.summary.kept,
        provenance: profile.platform[0]?.provenance ?? promises.items[0]?.provenance ?? null,
        positions: profile.platform.slice(0, 3).map((p) => ({
          cycle: p.cycle,
          policyArea: p.policyArea.name,
          stance: p.stance,
          sourceUrl: p.sourceUrl,
          provenance: p.provenance,
        })),
      },
    };
    return {
      person: { slug, fullName: row.fullName },
      asOf: row.refreshedAt,
      facts,
      paragraphs: buildGlance(facts),
    };
  },
});

/** Vote participation uses its own latest Congress, independently of the ideology estimate. */
async function loadParticipation(db: Db, slug: string) {
  const [latest] = await db
    .select({ congress: sql<number | null>`max(${rollcall.congress})` })
    .from(votePosition)
    .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
    .innerJoin(person, eq(person.id, votePosition.personId))
    .where(eq(person.slug, slug));
  const congress = latest?.congress ?? null;
  if (congress === null)
    return {
      congress,
      votesEligible: null,
      votesMissed: null,
      missedVoteRate: null,
      provenance: null,
    };
  const rows = await db
    .select({
      position: votePosition.position,
      sourceId: votePosition.sourceId,
      sourceKey: votePosition.sourceKey,
      ingestRunId: votePosition.ingestRunId,
      retrievedAt: votePosition.retrievedAt,
    })
    .from(votePosition)
    .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
    .innerJoin(person, eq(person.id, votePosition.personId))
    .where(and(eq(person.slug, slug), eq(rollcall.congress, congress)))
    .orderBy(desc(rollcall.voteDate), desc(rollcall.number));
  const votesEligible = rows.length;
  const votesMissed = rows.filter((r) => r.position === 'not_voting').length;
  return {
    congress,
    votesEligible,
    votesMissed,
    missedVoteRate: votesEligible > 0 ? votesMissed / votesEligible : null,
    provenance: rows[0] ? withProvenance(rows[0]).provenance : null,
  };
}
