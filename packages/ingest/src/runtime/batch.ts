import { conflictUpdateSet, type Db } from '@civic-ledger/db';
import type { IndexColumn, PgInsertValue, PgTable } from 'drizzle-orm/pg-core';
import type { LoadContext } from '../adapter';

/** Rows per INSERT; keeps every statement well under Postgres' 65,535 bind parameters. */
export const BATCH_SIZE = 1_000;

export interface Provenance {
  sourceId: string;
  sourceKey: string;
  ingestRunId: number;
  retrievedAt: Date;
}

export function provenance(ctx: LoadContext, sourceKey: string): Provenance {
  return {
    sourceId: ctx.sourceId,
    sourceKey,
    ingestRunId: ctx.ingestRunId,
    retrievedAt: ctx.retrievedAt,
  };
}

/** Groups an async stream into arrays of at most `size`. */
export async function* chunked<T>(items: AsyncIterable<T>, size = BATCH_SIZE): AsyncGenerator<T[]> {
  let batch: T[] = [];
  for await (const item of items) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

export function* chunks<T>(items: readonly T[], size = BATCH_SIZE): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * Last row wins per natural key. One INSERT ... ON CONFLICT DO UPDATE may not touch the
 * same row twice, so duplicates inside a batch must be collapsed first.
 */
export function lastPerKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return [...byKey.values()];
}

/**
 * Idempotent natural-key upsert of `rows` in batches, each batch in its own transaction.
 * Every column except the surrogate id is overwritten with the incoming value.
 */
export async function upsertAll<T extends PgTable>(
  db: Db,
  table: T,
  rows: readonly PgInsertValue<T>[],
  target: IndexColumn | IndexColumn[],
): Promise<number> {
  let written = 0;
  for (const batch of chunks(rows)) {
    await db.transaction(async (tx) => {
      await tx
        .insert(table)
        .values(batch)
        .onConflictDoUpdate({ target, set: conflictUpdateSet(table) });
    });
    written += batch.length;
  }
  return written;
}

/**
 * Batches a stream of tagged records, flushing whenever the tag changes, so a loader can
 * finish one record kind (e.g. members) before the next (votes) arrives.
 */
export async function* kindBatches<T extends { kind: string }>(
  records: AsyncIterable<T>,
  size = BATCH_SIZE,
): AsyncGenerator<{ kind: T['kind']; items: T[] }> {
  let kind: T['kind'] | null = null;
  let items: T[] = [];
  for await (const record of records) {
    if ((kind !== null && record.kind !== kind) || items.length >= size) {
      if (kind !== null && items.length > 0) yield { kind, items };
      items = [];
    }
    kind = record.kind;
    items.push(record);
  }
  if (kind !== null && items.length > 0) yield { kind, items };
}

/** Narrows a batch from `kindBatches` to one record kind. */
export function ofKind<T extends { kind: string }, K extends T['kind']>(
  items: T[],
  kind: K,
): Extract<T, { kind: K }>[] {
  return items.filter((i): i is Extract<T, { kind: K }> => i.kind === kind);
}
