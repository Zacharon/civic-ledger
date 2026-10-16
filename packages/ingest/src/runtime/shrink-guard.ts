import { formatIngestScope, type IngestScope, type SourceId } from '@civic-ledger/core';
import { type Db, ingestRun } from '@civic-ledger/db';
import { and, desc, eq, sql } from 'drizzle-orm';

/**
 * Sanity floor for upstream shrinkage (DECISIONS A41). A truncated or empty upstream file
 * is a valid-looking input whose stale-row sweep would delete a source's rows, so a load
 * is refused when it would delete too much or load far fewer records than last time.
 */
export interface ShrinkGuardConfig {
  /** Operator override (`--allow-shrink`): log the violation and commit anyway. */
  allow: boolean;
  /** Largest share of the source's existing rows a run may delete (0..1). */
  maxDeleteFraction: number;
  /** Smallest share of the last successful run's record total a run may load (0..1). */
  minRecordRatio: number;
  /** The record-count floor applies only when the last run loaded at least this many. */
  minBaseline: number;
}

export const DEFAULT_SHRINK_GUARD: ShrinkGuardConfig = {
  allow: false,
  maxDeleteFraction: 0.1,
  minRecordRatio: 0.5,
  minBaseline: 20,
};

export class ShrinkGuardError extends Error {
  constructor(reason: string) {
    super(
      `shrink guard: ${reason}. Rolled back; no rows were changed. Rerun with --allow-shrink if the source really shrank.`,
    );
    this.name = 'ShrinkGuardError';
  }
}

function fractionFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1, got "${raw}"`);
  }
  return value;
}

export function shrinkGuardFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  allow = false,
): ShrinkGuardConfig {
  const baseline = env.INGEST_MIN_RECORD_BASELINE?.trim();
  const minBaseline = baseline ? Number(baseline) : DEFAULT_SHRINK_GUARD.minBaseline;
  if (!Number.isInteger(minBaseline) || minBaseline < 0) {
    throw new Error(`INGEST_MIN_RECORD_BASELINE must be a non-negative integer, got "${baseline}"`);
  }
  return {
    allow,
    maxDeleteFraction: fractionFromEnv(
      env,
      'INGEST_MAX_DELETE_FRACTION',
      DEFAULT_SHRINK_GUARD.maxDeleteFraction,
    ),
    minRecordRatio: fractionFromEnv(
      env,
      'INGEST_MIN_RECORD_RATIO',
      DEFAULT_SHRINK_GUARD.minRecordRatio,
    ),
    minBaseline,
  };
}

/** Rows a source currently owns: every base table with a `source_id` column except the ledger. */
export async function countSourceRows(db: Db, sourceId: SourceId): Promise<number> {
  const tables = (
    (await db.execute(sql`
      select c.table_name as name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = current_schema()
        and c.column_name = 'source_id'
        and t.table_type = 'BASE TABLE'
        and c.table_name <> 'ingest_run'
      order by c.table_name`)) as unknown as { rows: { name: string }[] }
  ).rows;
  if (tables.length === 0) return 0;
  const counts = tables.map(
    (t) => sql`(select count(*) from ${sql.identifier(t.name)} where source_id = ${sourceId})`,
  );
  const result = (await db.execute(
    sql`select (${sql.join(counts, sql` + `)})::int as n`,
  )) as unknown as { rows: { n: number }[] };
  return result.rows[0]?.n ?? 0;
}

/** Counts of the last successful run of the same source and scope, or null on a first load. */
export async function previousRunCounts(
  db: Db,
  sourceId: SourceId,
  scope: IngestScope,
): Promise<Record<string, number> | null> {
  const [row] = await db
    .select({ counts: ingestRun.counts })
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.sourceId, sourceId),
        eq(ingestRun.scope, formatIngestScope(scope)),
        eq(ingestRun.status, 'succeeded'),
      ),
    )
    .orderBy(desc(ingestRun.id))
    .limit(1);
  return row?.counts ?? null;
}

const isSweepCount = (key: string) => /^stale_.*_deleted$/.test(key);

/** Records a run loaded: the sum of its counters except the sweep counters. */
export function recordTotal(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((sum, [key, n]) => (isSweepCount(key) ? sum : sum + n), 0);
}

export function deletedTotal(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((sum, [key, n]) => (isSweepCount(key) ? sum + n : sum), 0);
}

export interface ShrinkInput {
  existingRows: number;
  counts: Record<string, number>;
  previous: Record<string, number> | null;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** A human-readable violation, or null when the run is within bounds. */
export function evaluateShrink(input: ShrinkInput, config: ShrinkGuardConfig): string | null {
  const deleted = deletedTotal(input.counts);
  if (input.existingRows > 0 && deleted / input.existingRows > config.maxDeleteFraction) {
    return (
      `the stale-row sweep would delete ${deleted} of ${input.existingRows} existing rows ` +
      `(${pct(deleted / input.existingRows)}, limit ${pct(config.maxDeleteFraction)})`
    );
  }
  if (input.previous) {
    const before = recordTotal(input.previous);
    const now = recordTotal(input.counts);
    if (before >= config.minBaseline && now < before * config.minRecordRatio) {
      return (
        `loaded ${now} records against ${before} in the last successful run ` +
        `(${pct(now / before)}, floor ${pct(config.minRecordRatio)})`
      );
    }
  }
  return null;
}
