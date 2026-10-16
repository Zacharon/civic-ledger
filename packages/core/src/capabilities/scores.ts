import {
  ideologyScore,
  person,
  scorecardPublisher,
  scorecardScore,
  TERMS_STATUSES,
} from '@civic-ledger/db';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { CongressSchema, PersonRefSchema, ProvenanceSchema, SlugSchema } from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

const IDEOLOGY_LABELS: Record<string, string> = {
  'dw-nominate': 'DW-NOMINATE (Voteview): academic, roll-call based',
};

const PublisherSchema = z.object({
  id: z.string(),
  name: z.string(),
  selfDescribedOrientation: z.string().describe("The publisher's own description of its viewpoint"),
  url: z.url(),
  methodologyUrl: z.url(),
});

export const ScoresListInput = z.strictObject({ slug: SlugSchema });

export const ScoresListOutput = z.object({
  person: PersonRefSchema,
  ideology: z.array(
    z.object({
      congress: CongressSchema,
      method: z.string(),
      label: z.string(),
      dim1: z.number(),
      dim2: z.number().nullable(),
      provenance: ProvenanceSchema,
    }),
  ),
  scorecards: z
    .array(
      z.object({
        publisher: PublisherSchema,
        year: z.int(),
        score: z.number(),
        scale: z.object({ min: z.number(), max: z.number(), label: z.string() }),
        methodologyUrl: z.url(),
        provenance: ProvenanceSchema,
      }),
    )
    .describe('Only publishers whose terms are cleared (DECISIONS D2)'),
  linkOnlyPublishers: z
    .array(PublisherSchema.extend({ termsStatus: z.enum(TERMS_STATUSES) }))
    .describe('Publishers shown as links only until their terms are cleared'),
});

export const scoresList = defineCapability({
  name: 'scores.list',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Independent scores side by side, each with publisher, orientation, year, scale and method.',
  input: ScoresListInput,
  output: ScoresListOutput,
  async handler({ db }, { slug }) {
    const [who] = await db
      .select({ id: person.id, slug: person.slug, fullName: person.fullName })
      .from(person)
      .where(eq(person.slug, slug))
      .limit(1);
    if (!who) throw notFound(`No person with slug "${slug}"`);

    const publisherFields = {
      id: scorecardPublisher.id,
      name: scorecardPublisher.name,
      selfDescribedOrientation: scorecardPublisher.selfDescribedOrientation,
      url: scorecardPublisher.url,
      methodologyUrl: scorecardPublisher.methodologyUrl,
    };
    const [ideology, scorecards, linkOnly] = await Promise.all([
      db
        .select({
          congress: ideologyScore.congress,
          method: ideologyScore.method,
          dim1: ideologyScore.dim1,
          dim2: ideologyScore.dim2,
          ...provenanceFields(ideologyScore),
        })
        .from(ideologyScore)
        .where(eq(ideologyScore.personId, who.id))
        .orderBy(desc(ideologyScore.congress), asc(ideologyScore.method)),
      db
        .select({
          publisher: publisherFields,
          year: scorecardScore.year,
          score: scorecardScore.score,
          scaleMin: scorecardScore.scaleMin,
          scaleMax: scorecardScore.scaleMax,
          scaleLabel: scorecardScore.scaleLabel,
          methodologyUrl: scorecardScore.methodologyUrl,
          ...provenanceFields(scorecardScore),
        })
        .from(scorecardScore)
        .innerJoin(scorecardPublisher, eq(scorecardPublisher.id, scorecardScore.publisherId))
        .where(
          and(eq(scorecardScore.personId, who.id), eq(scorecardPublisher.termsStatus, 'cleared')),
        )
        .orderBy(asc(scorecardPublisher.name), desc(scorecardScore.year)),
      db
        .select({ ...publisherFields, termsStatus: scorecardPublisher.termsStatus })
        .from(scorecardPublisher)
        .where(ne(scorecardPublisher.termsStatus, 'cleared'))
        .orderBy(asc(scorecardPublisher.name)),
    ]);

    return {
      person: { slug: who.slug, fullName: who.fullName },
      ideology: ideology.map((row) => ({
        ...withProvenance(row),
        label: IDEOLOGY_LABELS[row.method] ?? row.method,
      })),
      scorecards: scorecards
        .map(withProvenance)
        .map(({ scaleMin, scaleMax, scaleLabel, ...row }) => ({
          ...row,
          scale: { min: scaleMin, max: scaleMax, label: scaleLabel },
        })),
      linkOnlyPublishers: linkOnly,
    };
  },
});
