import { type AnyPgColumn, index, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { ingestRun, source } from './operations';

/** Provenance columns carried by every fact table (ARCHITECTURE §1.3, §3). */
export function provenanceColumns() {
  return {
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id),
    sourceKey: text('source_key').notNull(),
    ingestRunId: integer('ingest_run_id')
      .notNull()
      .references(() => ingestRun.id),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  };
}

/** Indexes the two provenance foreign keys of a fact table. */
export function provenanceIndexes(
  table: string,
  t: { sourceId: AnyPgColumn; sourceKey: AnyPgColumn; ingestRunId: AnyPgColumn },
) {
  return [
    index(`${table}_source_idx`).on(t.sourceId, t.sourceKey),
    index(`${table}_ingest_run_idx`).on(t.ingestRunId),
  ];
}
