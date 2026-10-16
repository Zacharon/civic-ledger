import {
  committeeContribution,
  committeeIndustry,
  INGEST_STATUSES,
  ingestRun,
  personCard,
  source,
} from '@civic-ledger/db';
import { asc, desc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { CentsSchema, EmptyInputSchema, IsoDateTimeSchema, ShareSchema } from '../schemas/common';

const RunSchema = z.object({
  id: z.int(),
  status: z.enum(INGEST_STATUSES),
  adapterVersion: z.string(),
  scope: z.string(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  counts: z.record(z.string(), z.int()),
  error: z.string().nullable(),
});

export const SourcesStatusOutput = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.url(),
      license: z.string(),
      licenseUrl: z.url().nullable(),
      description: z.string(),
      lastRun: RunSchema.nullable(),
      lastSuccess: RunSchema.nullable(),
    }),
  ),
  coverage: z.object({
    industryCoding: z.object({
      totalCents: CentsSchema,
      codedCents: CentsSchema,
      coverage: ShareSchema.nullable(),
    }),
  }),
  readModelRefreshedAt: IsoDateTimeSchema.nullable(),
});

type RunRow = typeof ingestRun.$inferSelect;

export const sourcesStatus = defineCapability({
  name: 'sources.status',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Every data source with terms, latest and latest successful run, and coverage.',
  input: EmptyInputSchema,
  output: SourcesStatusOutput,
  async handler({ db }) {
    const latestRunPerSource = () =>
      db
        .selectDistinctOn([ingestRun.sourceId])
        .from(ingestRun)
        .orderBy(ingestRun.sourceId, desc(ingestRun.startedAt), desc(ingestRun.id))
        .$dynamic();
    const [sources, lastRuns, lastSuccesses, [coverage], [refreshed]] = await Promise.all([
      db.select().from(source).orderBy(asc(source.id)),
      latestRunPerSource(),
      latestRunPerSource().where(eq(ingestRun.status, 'succeeded')),
      db
        .select({
          totalCents:
            sql<number>`coalesce(sum(${committeeContribution.amountCents}), 0)::bigint`.mapWith(
              Number,
            ),
          codedCents:
            sql<number>`coalesce(sum(${committeeContribution.amountCents}) filter (where ${committeeIndustry.id} is not null), 0)::bigint`.mapWith(
              Number,
            ),
        })
        .from(committeeContribution)
        .leftJoin(
          committeeIndustry,
          eq(committeeIndustry.committeeId, committeeContribution.committeeId),
        ),
      db.select({ at: max(personCard.refreshedAt) }).from(personCard),
    ]);
    const totalCents = coverage?.totalCents ?? 0;
    const codedCents = coverage?.codedCents ?? 0;
    return {
      sources: sources.map((s) => ({
        ...s,
        lastRun: toRun(lastRuns.find((r) => r.sourceId === s.id)),
        lastSuccess: toRun(lastSuccesses.find((r) => r.sourceId === s.id)),
      })),
      coverage: {
        industryCoding: {
          totalCents,
          codedCents,
          coverage: totalCents > 0 ? codedCents / totalCents : null,
        },
      },
      readModelRefreshedAt: refreshed?.at ? refreshed.at.toISOString() : null,
    };
  },
});

function toRun(run: RunRow | undefined): z.input<typeof RunSchema> | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    adapterVersion: run.adapterVersion,
    scope: run.scope,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    counts: run.counts,
    error: run.error,
  };
}
