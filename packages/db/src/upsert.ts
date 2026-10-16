import { getTableColumns, type SQL, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * `set` clause for `onConflictDoUpdate` that overwrites every column except the
 * surrogate `id` with the incoming row, making natural-key upserts idempotent.
 */
export function conflictUpdateSet(table: PgTable): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (key !== 'id') set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}
