import {
  bill,
  candidateCycleTotals,
  committeeContribution,
  committeeIndustry,
  type Db,
  type INGEST_STATUSES,
  ingestCheck,
  ingestRun,
  personCard,
  rollcall,
  source,
} from '@civic-ledger/db';
import { asc, desc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import {
  CentsSchema,
  EmptyInputSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ShareSchema,
} from '../schemas/common';

/**
 * `sources.status@1` keeps its original status values: a client of v1 never sees a new
 * enum member. A `cancelled` run (DECISIONS A52) is reported as `failed`; its error text
 * starts with `cancelled:`.
 */
const PUBLIC_RUN_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'partial',
] as const satisfies readonly (typeof INGEST_STATUSES)[number][];

const RunSchema = z.object({
  id: z.int(),
  status: z.enum(PUBLIC_RUN_STATUSES),
  adapterVersion: z.string(),
  scope: z.string(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  counts: z.record(z.string(), z.int()),
  error: z.string().nullable(),
});

/**
 * Outcome of the latest attempt (evidence trust, migration 0006): `published` = a run that
 * committed a publication, `unchanged` = a successful check that found the current
 * publication unchanged (an `ingest_check`), `failed` = a failed or cancelled run,
 * `running` = a run in progress, null = never attempted.
 */
export const ATTEMPT_OUTCOMES = ['published', 'unchanged', 'failed', 'running'] as const;

const AttemptFields = {
  lastAttemptAt: IsoDateTimeSchema.nullable().describe(
    'Start of the latest attempt: a run of any status, or a check that found no change',
  ),
  lastAttemptOutcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
  lastSuccessfulCheckAt: IsoDateTimeSchema.nullable().describe(
    'When upstream was last confirmed: the latest successful run or unchanged check',
  ),
  lastChangedAt: IsoDateTimeSchema.nullable().describe(
    'When the published data last changed: the latest successful run',
  ),
};

const FreshnessSchema = z.object({
  ...AttemptFields,
  coverageThrough: IsoDateSchema.nullable().describe(
    'The reporting period of the loaded data, derived from its own facts; never the check time',
  ),
  coverageBasis: z
    .string()
    .nullable()
    .describe('How coverageThrough is derived, or why it is null'),
});

const ScopeFreshnessSchema = z.object({
  scope: z.string(),
  ...AttemptFields,
  publicationRunId: z
    .int()
    .nullable()
    .describe('The current publication of the scope (its latest successful run)'),
  coverageThrough: IsoDateSchema.nullable(),
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
      freshness: FreshnessSchema,
      scopes: z.array(ScopeFreshnessSchema),
    }),
  ),
  coverage: z.object({
    industryCoding: z.object({
      totalCents: CentsSchema.describe('Gross positive committee contributions, all cycles'),
      codedCents: CentsSchema.describe('Gross positive, from industry-coded committees'),
      coverage: ShareSchema.nullable(),
    }),
  }),
  readModelRefreshedAt: IsoDateTimeSchema.nullable(),
});

type RunRow = typeof ingestRun.$inferSelect;
type CheckRow = typeof ingestCheck.$inferSelect;
type ScopeFreshness = z.input<typeof ScopeFreshnessSchema>;
type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const sourcesStatus = defineCapability({
  name: 'sources.status',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Every data source with terms, latest and latest successful run, check freshness, data coverage dates and industry coverage.',
  input: EmptyInputSchema,
  output: SourcesStatusOutput,
  async handler({ db }) {
    const latestRunPerSource = () =>
      db
        .selectDistinctOn([ingestRun.sourceId])
        .from(ingestRun)
        .orderBy(ingestRun.sourceId, desc(ingestRun.startedAt), desc(ingestRun.id))
        .$dynamic();
    const [
      sources,
      lastRuns,
      lastSuccesses,
      scopeRuns,
      scopeSuccesses,
      scopeChecks,
      dataCoverage,
      [coverage],
      [refreshed],
    ] = await Promise.all([
      db.select().from(source).orderBy(asc(source.id)),
      latestRunPerSource(),
      latestRunPerSource().where(eq(ingestRun.status, 'succeeded')),
      // Per scope: the latest run of any status, the current publication, the latest check.
      db
        .selectDistinctOn([ingestRun.sourceId, ingestRun.scope])
        .from(ingestRun)
        .orderBy(
          ingestRun.sourceId,
          ingestRun.scope,
          desc(ingestRun.startedAt),
          desc(ingestRun.id),
        ),
      db
        .selectDistinctOn([ingestRun.sourceId, ingestRun.scope])
        .from(ingestRun)
        .where(eq(ingestRun.status, 'succeeded'))
        .orderBy(ingestRun.sourceId, ingestRun.scope, desc(ingestRun.id)),
      db
        .selectDistinctOn([ingestCheck.sourceId, ingestCheck.scope])
        .from(ingestCheck)
        .orderBy(
          ingestCheck.sourceId,
          ingestCheck.scope,
          desc(ingestCheck.checkedAt),
          desc(ingestCheck.id),
        ),
      coverageByScope(db),
      // Gross positive dollars, the same base as person_card and money.summary.
      db
        .select({
          totalCents:
            sql<number>`coalesce(sum(${committeeContribution.amountCents}) filter (where ${committeeContribution.amountCents} > 0), 0)::bigint`.mapWith(
              Number,
            ),
          codedCents:
            sql<number>`coalesce(sum(${committeeContribution.amountCents}) filter (where ${committeeIndustry.id} is not null and ${committeeContribution.amountCents} > 0), 0)::bigint`.mapWith(
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
      sources: sources.map((s) => {
        const covered = dataCoverage.get(s.id);
        const scopes = scopeFreshness(
          scopeRuns.filter((r) => r.sourceId === s.id),
          scopeSuccesses.filter((r) => r.sourceId === s.id),
          scopeChecks.filter((c) => c.sourceId === s.id),
          covered,
        );
        return {
          ...s,
          lastRun: toRun(lastRuns.find((r) => r.sourceId === s.id)),
          lastSuccess: toRun(lastSuccesses.find((r) => r.sourceId === s.id)),
          freshness: {
            ...latestAttempt(scopes),
            lastSuccessfulCheckAt: latest(scopes.map((x) => x.lastSuccessfulCheckAt)),
            lastChangedAt: latest(scopes.map((x) => x.lastChangedAt)),
            coverageThrough: latest([...(covered?.values() ?? [])]),
            coverageBasis: COVERAGE_BASIS[s.id] ?? NO_COVERAGE_BASIS,
          },
          scopes,
        };
      }),
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
    status: run.status === 'cancelled' ? 'failed' : run.status,
    adapterVersion: run.adapterVersion,
    scope: run.scope,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    counts: run.counts,
    error: run.error,
  };
}

/**
 * How each source's `coverageThrough` is derived from its own loaded facts. A source
 * without a reporting period says so; its freshness is the check time, reported apart.
 */
const COVERAGE_BASIS: Record<string, string> = {
  voteview: 'Latest roll-call vote date loaded from Voteview, per Congress.',
  'fec-bulk':
    'Latest report coverage end date among the FEC candidate totals (weball) loaded, per cycle.',
  'govinfo-billstatus': 'Latest bill action date loaded from BILLSTATUS, per Congress.',
  'congress-legislators':
    'No reporting period: the current roster and term history as published; see last checked.',
  curated: 'No reporting period: reviewed repository data; see last checked.',
};
const NO_COVERAGE_BASIS = 'No reporting period is derived for this source.';

/** Per source, the latest data date of each scope it has facts for (`congress:N`, `cycle:N`). */
async function coverageByScope(db: Db): Promise<Map<string, Map<string, string>>> {
  const [votes, money, bills] = await Promise.all([
    db
      .select({
        key: rollcall.congress,
        through: sql<string | null>`max(${rollcall.voteDate})::text`,
      })
      .from(rollcall)
      .where(eq(rollcall.sourceId, 'voteview'))
      .groupBy(rollcall.congress),
    db
      .select({
        key: candidateCycleTotals.cycle,
        through: sql<string | null>`max(${candidateCycleTotals.coverageEndDate})::text`,
      })
      .from(candidateCycleTotals)
      .where(eq(candidateCycleTotals.sourceId, 'fec-bulk'))
      .groupBy(candidateCycleTotals.cycle),
    db
      .select({
        key: bill.congress,
        through: sql<string | null>`max(${bill.latestActionDate})::text`,
      })
      .from(bill)
      .where(eq(bill.sourceId, 'govinfo-billstatus'))
      .groupBy(bill.congress),
  ]);
  const out = new Map<string, Map<string, string>>();
  const add = (sourceId: string, kind: string, rows: { key: number; through: string | null }[]) => {
    const scopes = new Map<string, string>();
    for (const row of rows) if (row.through) scopes.set(`${kind}:${row.key}`, row.through);
    out.set(sourceId, scopes);
  };
  add('voteview', 'congress', votes);
  add('fec-bulk', 'cycle', money);
  add('govinfo-billstatus', 'congress', bills);
  return out;
}

/** Freshness of every scope the source has a run or a check for, ordered by scope. */
function scopeFreshness(
  runs: RunRow[],
  successes: RunRow[],
  checks: CheckRow[],
  coverage: Map<string, string> | undefined,
): ScopeFreshness[] {
  const names = [...new Set([...runs, ...checks].map((r) => r.scope))].sort();
  return names.map((scope) => {
    const run = runs.find((r) => r.scope === scope);
    const success = successes.find((r) => r.scope === scope);
    const check = checks.find((c) => c.scope === scope);
    const checkIsLater =
      check !== undefined && (!run || check.startedAt.getTime() >= run.startedAt.getTime());
    const attempt = checkIsLater ? check.startedAt : run?.startedAt;
    return {
      scope,
      lastAttemptAt: attempt?.toISOString() ?? null,
      lastAttemptOutcome: checkIsLater ? 'unchanged' : run ? runOutcome(run) : null,
      lastSuccessfulCheckAt: latest([
        success?.finishedAt?.toISOString(),
        check?.checkedAt.toISOString(),
      ]),
      lastChangedAt: success?.finishedAt?.toISOString() ?? null,
      publicationRunId: success?.id ?? null,
      coverageThrough: coverage?.get(scope) ?? null,
    };
  });
}

/** `cancelled` (and the never-written `partial`) map to `failed`, as `lastRun` does. */
function runOutcome(run: RunRow): AttemptOutcome {
  if (run.status === 'succeeded') return 'published';
  if (run.status === 'running') return 'running';
  return 'failed';
}

/** The source-level latest attempt: the most recent attempt across its scopes. */
function latestAttempt(scopes: ScopeFreshness[]): {
  lastAttemptAt: string | null;
  lastAttemptOutcome: AttemptOutcome | null;
} {
  let best: ScopeFreshness | null = null;
  for (const scope of scopes) {
    if (scope.lastAttemptAt && (!best?.lastAttemptAt || scope.lastAttemptAt > best.lastAttemptAt))
      best = scope;
  }
  return {
    lastAttemptAt: best?.lastAttemptAt ?? null,
    lastAttemptOutcome: best?.lastAttemptOutcome ?? null,
  };
}

/** The latest of ISO timestamps (all UTC `toISOString`) or of ISO dates; null if none. */
function latest(values: readonly (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const value of values) if (value && (!out || value > out)) out = value;
  return out;
}
