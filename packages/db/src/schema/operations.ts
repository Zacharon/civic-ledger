import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `cancelled`: stopped by the operator or the run deadline before commit (nothing changed).
 * `partial` is never written (a load is one transaction); kept because enum values cannot
 * be dropped in place.
 */
export const INGEST_STATUSES = ['running', 'succeeded', 'failed', 'partial', 'cancelled'] as const;
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
    /** Operator-visible note on a run that succeeded, e.g. an overridden shrink guard. */
    note: text('note'),
    /** `--force-replay`: the earlier successful run whose snapshot this run reloaded. */
    replayOf: integer('replay_of'),
    /**
     * Where this run's raw evidence lives: a path relative to the raw root for an immutable
     * fetched snapshot, or the absolute directory given with `--snapshot`. Null on runs that
     * predate migration 0009 (their evidence, if retained, is in the legacy
     * `<source>/<YYYY-MM-DD>` directory, which a later same-day run could overwrite).
     */
    snapshotLocator: text('snapshot_locator'),
  },
  (t) => [
    index('ingest_run_source_started_idx').on(t.sourceId, t.startedAt),
    index('ingest_run_dedupe_idx').on(t.sourceId, t.adapterVersion, t.snapshotChecksum),
  ],
);

/**
 * A successful upstream check that found the current publication unchanged (its key equals
 * the latest successful run of the scope). The publication receipt stays immutable; this
 * row records that the source was validated again (migration 0009). Changed publications
 * and failed attempts remain `ingest_run` rows.
 */
export const ingestCheck = pgTable(
  'ingest_check',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id),
    scope: text('scope').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    /** Only `unchanged` is written today. */
    outcome: text('outcome').notNull().default('unchanged'),
    snapshotChecksum: text('snapshot_checksum').notNull(),
    /** The publication this check confirmed (the current generation of the scope). */
    publicationRunId: integer('publication_run_id')
      .notNull()
      .references(() => ingestRun.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingest_check_source_scope_idx').on(t.sourceId, t.scope, t.checkedAt),
    index('ingest_check_publication_run_idx').on(t.publicationRunId),
  ],
);
