import { formatIngestScope, type IngestScope, type SourceId } from '@civic-ledger/core';
import { type Db, ingestRun } from '@civic-ledger/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ShrinkDataset } from '../adapter';

/**
 * Sanity floor for upstream shrinkage (DECISIONS A42, A51). A truncated or empty upstream
 * file is a valid-looking input whose stale-row sweep would delete a source's rows, so a
 * load is refused when it would delete too much or load far fewer records than last time,
 * judged per dataset (table and scope) and for the source as a whole.
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

/** Rows each swept dataset holds for this source and scope, before the load. */
export async function countDatasetRows(
  db: Db,
  sourceId: SourceId,
  scope: IngestScope,
  datasets: readonly ShrinkDataset[],
): Promise<DatasetInput[]> {
  const scopeValue =
    scope.kind === 'cycle' ? scope.cycle : scope.kind === 'congress' ? scope.congress : null;
  const out: DatasetInput[] = [];
  for (const dataset of datasets) {
    if (!dataset.swept) {
      out.push({ dataset, existing: null });
      continue;
    }
    const via = dataset.scopeVia;
    const inScope =
      scopeValue === null
        ? sql``
        : dataset.scopeColumn
          ? sql` and ${sql.identifier(dataset.scopeColumn)} = ${scopeValue}`
          : via
            ? sql` and ${sql.identifier(via.column)} in (select id from ${sql.identifier(via.table)} where ${sql.identifier(via.scopeColumn)} = ${scopeValue})`
            : sql``;
    const result = (await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(dataset.table)} where source_id = ${sourceId}${inScope}`,
    )) as unknown as { rows: { n: number }[] };
    out.push({ dataset, existing: result.rows[0]?.n ?? 0 });
  }
  return out;
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

/**
 * Records a run loaded: the sum of `loadedKeys` (an adapter's explicit loaded-row counters)
 * or, for an adapter that declares none, of every counter except the sweep counters.
 */
export function recordTotal(
  counts: Record<string, number>,
  loadedKeys?: readonly string[],
): number {
  if (loadedKeys) return loadedKeys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
  return Object.entries(counts).reduce((sum, [key, n]) => (isSweepCount(key) ? sum : sum + n), 0);
}

export function deletedTotal(
  counts: Record<string, number>,
  sweptKeys?: readonly string[],
): number {
  if (sweptKeys) return sweptKeys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
  return Object.entries(counts).reduce((sum, [key, n]) => (isSweepCount(key) ? sum + n : sum), 0);
}

/** One dataset to judge on its own: its declaration and its rows before the load. */
export interface DatasetInput {
  dataset: ShrinkDataset;
  /** Rows of `dataset.table` in this source and scope before the load (swept tables). */
  existing: number | null;
}

export interface ShrinkInput {
  existingRows: number;
  counts: Record<string, number>;
  previous: Record<string, number> | null;
  /** Per-dataset checks (DECISIONS A51); without them only the source totals are checked. */
  datasets?: readonly DatasetInput[];
  /** Scope label for messages, e.g. `cycle:2026`. */
  scope?: string;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function datasetViolations(input: ShrinkInput, config: ShrinkGuardConfig): string[] {
  const out: string[] = [];
  const where = input.scope ? ` for ${input.scope}` : '';
  for (const { dataset, existing } of input.datasets ?? []) {
    const deleted = dataset.swept ? (input.counts[dataset.swept] ?? 0) : 0;
    // A small table may lose a few rows; deleting every row of any dataset is always suspect.
    const judged =
      existing !== null && existing > 0 && (existing >= config.minBaseline || deleted === existing);
    if (judged && deleted / existing > config.maxDeleteFraction) {
      out.push(
        `the stale-row sweep would delete ${deleted} of ${existing} existing rows in ${dataset.table}${where} ` +
          `(${pct(deleted / existing)}, limit ${pct(config.maxDeleteFraction)})`,
      );
    }
    const before = input.previous?.[dataset.loaded];
    const now = input.counts[dataset.loaded] ?? 0;
    if (
      before !== undefined &&
      before >= config.minBaseline &&
      now < before * config.minRecordRatio
    ) {
      out.push(
        `loaded ${now} ${dataset.loaded} into ${dataset.table} against ${before} in the last successful run${where} ` +
          `(${pct(now / before)}, floor ${pct(config.minRecordRatio)})`,
      );
    }
  }
  return out;
}

/**
 * Human-readable violations joined by "; ", or null when the run is within bounds. The
 * source totals (A42) are kept as an outer bound; the per-dataset checks (A51) stop one
 * table or scope from collapsing behind the others or behind diagnostic counters.
 */
export function evaluateShrink(input: ShrinkInput, config: ShrinkGuardConfig): string | null {
  const loadedKeys = input.datasets?.map((d) => d.dataset.loaded);
  const sweptKeys = input.datasets?.flatMap((d) => (d.dataset.swept ? [d.dataset.swept] : []));
  const out: string[] = [];
  const deleted = deletedTotal(input.counts, sweptKeys);
  if (input.existingRows > 0 && deleted / input.existingRows > config.maxDeleteFraction) {
    out.push(
      `the stale-row sweep would delete ${deleted} of ${input.existingRows} existing rows ` +
        `(${pct(deleted / input.existingRows)}, limit ${pct(config.maxDeleteFraction)})`,
    );
  }
  if (input.previous) {
    const before = recordTotal(input.previous, loadedKeys);
    const now = recordTotal(input.counts, loadedKeys);
    if (before >= config.minBaseline && now < before * config.minRecordRatio) {
      out.push(
        `loaded ${now} records against ${before} in the last successful run ` +
          `(${pct(now / before)}, floor ${pct(config.minRecordRatio)})`,
      );
    }
  }
  out.push(...datasetViolations(input, config));
  return out.length > 0 ? out.join('; ') : null;
}
