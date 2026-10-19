import { type IngestRunReceipt, type SourceId, SourceIdSchema } from '@civic-ledger/core';
import {
  conflictUpdateSet,
  type Db,
  ingestCheck,
  ingestRun,
  personCard,
  source,
} from '@civic-ledger/db';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import type { SourceInfo } from '../adapter';

type RunRow = typeof ingestRun.$inferSelect;
type CheckRow = typeof ingestCheck.$inferSelect;

/** The `source` row is the Sources page entry: terms and description per source. */
export async function ensureSource(db: Db, info: SourceInfo): Promise<void> {
  await db
    .insert(source)
    .values(info)
    .onConflictDoUpdate({ target: source.id, set: conflictUpdateSet(source) });
}

/**
 * Marks `running` rows of a source as failed. Only called while holding the source lock,
 * so any such row belongs to a process that died mid-run.
 */
export async function reapAbandonedRuns(db: Db, sourceId: SourceId): Promise<number> {
  const reaped = await db
    .update(ingestRun)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      error:
        'abandoned: the process exited before the run finished; its load transaction was rolled back, nothing was committed',
    })
    .where(and(eq(ingestRun.sourceId, sourceId), eq(ingestRun.status, 'running')))
    .returning({ id: ingestRun.id });
  return reaped.length;
}

export async function startRun(
  db: Db,
  values: { sourceId: SourceId; adapterVersion: string; scope: string },
): Promise<RunRow> {
  const [row] = await db
    .insert(ingestRun)
    .values({ ...values, actor: 'operator' })
    .returning();
  if (!row) throw new Error('Could not create the ingest_run row');
  return row;
}

/**
 * The earliest successful run for an idempotency key, if any: the origin a forced replay
 * names in `replayOf`. Whether a repeat deduplicates is decided by `latestSucceededRun`.
 */
export async function findSucceededRun(
  db: Db,
  key: { sourceId: SourceId; adapterVersion: string; snapshotChecksum: string },
): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.sourceId, key.sourceId),
        eq(ingestRun.adapterVersion, key.adapterVersion),
        eq(ingestRun.snapshotChecksum, key.snapshotChecksum),
        eq(ingestRun.status, 'succeeded'),
      ),
    )
    .orderBy(ingestRun.id)
    .limit(1);
  return row ?? null;
}

/**
 * The latest successful run of a source and scope: the current generation. A repeat of its
 * key deduplicates to it; a key that succeeded earlier but differs from it was superseded
 * (DECISIONS A54).
 */
export async function latestSucceededRun(
  db: Db,
  sourceId: SourceId,
  scope: string,
): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.sourceId, sourceId),
        eq(ingestRun.scope, scope),
        eq(ingestRun.status, 'succeeded'),
      ),
    )
    .orderBy(desc(ingestRun.id))
    .limit(1);
  return row ?? null;
}

/**
 * Records a terminal outcome only while the row is still `running`. If the commit of a
 * successful run reached the database but its acknowledgement was lost, the row already
 * says `succeeded`, and that committed receipt is returned instead of being overwritten.
 */
export async function finishRun(
  db: Db,
  id: number,
  values: Partial<Omit<RunRow, 'id' | 'sourceId' | 'status'>> & { status: RunRow['status'] },
): Promise<RunRow> {
  const [row] = await db
    .update(ingestRun)
    .set(values)
    .where(and(eq(ingestRun.id, id), eq(ingestRun.status, 'running')))
    .returning();
  if (row) return row;
  const [current] = await db.select().from(ingestRun).where(eq(ingestRun.id, id));
  if (!current) throw new Error(`ingest_run ${id} disappeared`);
  return current;
}

export async function updateRun(
  db: Db,
  id: number,
  values: Partial<Omit<RunRow, 'id' | 'sourceId'>>,
): Promise<RunRow> {
  const [row] = await db.update(ingestRun).set(values).where(eq(ingestRun.id, id)).returning();
  if (!row) throw new Error(`ingest_run ${id} disappeared`);
  return row;
}

export async function deleteRun(db: Db, id: number): Promise<void> {
  await db.delete(ingestRun).where(eq(ingestRun.id, id));
}

/**
 * A deduplicated fetch (migration 0006): records that upstream was checked and still
 * matches the publication `publication`, and drops the attempt's provisional run row, in
 * one transaction. The publication receipt itself is never rewritten.
 */
export async function recordUnchangedCheck(
  db: Db,
  values: {
    provisionalRunId: number;
    publication: RunRow;
    scope: string;
    adapterVersion: string;
    snapshotChecksum: string;
    startedAt: Date;
  },
): Promise<CheckRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(ingestCheck)
      .values({
        sourceId: values.publication.sourceId,
        scope: values.scope,
        adapterVersion: values.adapterVersion,
        outcome: 'unchanged',
        snapshotChecksum: values.snapshotChecksum,
        publicationRunId: values.publication.id,
        startedAt: values.startedAt,
      })
      .returning();
    if (!row) throw new Error('Could not create the ingest_check row');
    await tx.delete(ingestRun).where(eq(ingestRun.id, values.provisionalRunId));
    return row;
  });
}

/** Latest successful run id per source (null when a source never succeeded). */
export async function latestSucceededRunIds(
  db: Db,
  sources: readonly SourceId[],
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = Object.fromEntries(sources.map((s) => [s, null]));
  if (sources.length === 0) return out;
  const rows = await db
    .select({ sourceId: ingestRun.sourceId, id: max(ingestRun.id) })
    .from(ingestRun)
    .where(and(inArray(ingestRun.sourceId, [...sources]), eq(ingestRun.status, 'succeeded')))
    .groupBy(ingestRun.sourceId);
  for (const row of rows) out[row.sourceId] = row.id;
  return out;
}

export async function readModelRefreshedAt(db: Db): Promise<Date | null> {
  const [row] = await db.select({ at: max(personCard.refreshedAt) }).from(personCard);
  return row?.at ?? null;
}

/**
 * The receipt of `row`. `check` is the unchanged check a deduplicated fetch just recorded
 * (null when the run was not deduplicated, or was deduplicated from a `--snapshot` reload,
 * which is not an upstream check).
 */
export function toReceipt(
  row: RunRow,
  deduplicated: boolean,
  check: CheckRow | null = null,
): IngestRunReceipt {
  return {
    runId: row.id,
    operation: 'ingest.run',
    actor: 'operator',
    source: SourceIdSchema.parse(row.sourceId),
    scope: row.scope,
    adapterVersion: row.adapterVersion,
    snapshotChecksum: row.snapshotChecksum,
    status: row.status,
    deduplicated,
    counts: row.counts,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    readModelRefreshedBefore: row.readModelRefreshedBefore?.toISOString() ?? null,
    readModelRefreshedAfter: row.readModelRefreshedAfter?.toISOString() ?? null,
    error: row.error,
    note: row.note,
    replayOf: row.replayOf,
    snapshotLocator: row.snapshotLocator,
    check: check ? { id: check.id, checkedAt: check.checkedAt.toISOString() } : null,
  };
}
