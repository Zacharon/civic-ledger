import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const INGEST_STATUSES = ['running', 'succeeded', 'failed', 'partial'] as const;
export const ingestStatus = pgEnum('ingest_status', INGEST_STATUSES);

/** A public data source (or the dev seed / curated repo data). */
export const source = pgTable('source', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  license: text('license').notNull(),
  licenseUrl: text('license_url'),
  description: text('description').notNull(),
});

/** Run ledger: one row per ingest attempt; the row is the operator's receipt. */
export const ingestRun = pgTable(
  'ingest_run',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id),
    adapterVersion: text('adapter_version').notNull(),
    scope: text('scope').notNull(),
    actor: text('actor').notNull().default('operator'),
    status: ingestStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    snapshotChecksum: text('snapshot_checksum'),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    error: text('error'),
    readModelRefreshedBefore: timestamp('read_model_refreshed_before', { withTimezone: true }),
    readModelRefreshedAfter: timestamp('read_model_refreshed_after', { withTimezone: true }),
  },
  (t) => [
    index('ingest_run_source_started_idx').on(t.sourceId, t.startedAt),
    index('ingest_run_dedupe_idx').on(t.sourceId, t.adapterVersion, t.snapshotChecksum),
  ],
);
