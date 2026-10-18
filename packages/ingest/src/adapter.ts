import type { IngestScope, SourceId } from '@civic-ledger/core';
import type { Db } from '@civic-ledger/db';
import type { Logger } from 'pino';

/**
 * Source adapter contract (ARCHITECTURE §4). The runtime (`runtime/run.ts`) owns fetch,
 * the run ledger, locking, dedupe and read-model refresh; an adapter only says what to
 * fetch, how to parse it and how to load it:
 * - plan: the files for a scope. Downloads use a timeout, transient-only retries with
 *   backoff + full jitter, conditional GET, and land under data/raw/<source>/<date>/.
 * - parse: streaming; never buffer a whole large CSV/XML/ZIP in memory. No database access.
 *   Cross-row rules over a whole file (FEC amendments) are done by the loader in SQL.
 * - load: batched, idempotent upserts on natural keys, each batch a savepoint inside the
 *   run's one load transaction, every row stamped with provenance (source_id, source_key,
 *   ingest_run_id, retrieved_at).
 */
export interface SourceAdapter<TRecord> {
  source: SourceInfo;
  /** Part of the dedupe key (source, version, snapshot checksum). Bump on parser/loader changes. */
  version: string;
  /**
   * Sources whose loaded rows this one joins against. Their latest successful run ids are
   * folded into the snapshot checksum, so a rerun after an upstream reload is not deduped.
   */
  dependsOn: readonly SourceId[];
  /** Scope kinds the adapter accepts. */
  scopes: readonly IngestScope['kind'][];
  /**
   * Set false for git-reviewed sources, where removing a file is an intended change and a
   * large drop is not an upstream-truncation signal. Default true (runtime/shrink-guard.ts).
   */
  guardShrink?: boolean;
  /**
   * What the shrink guard checks for a guarded adapter: one entry per loaded table, with
   * its explicit loaded-row counter and, when swept, its sweep counter (DECISIONS A51).
   * Counters not listed here are diagnostics and never count as loaded records.
   */
  shrinkDatasets?: readonly ShrinkDataset[];
  plan(scope: IngestScope, ctx: PlanContext): Promise<FetchPlan>;
  parse(snapshot: RawSnapshot, scope: IngestScope, ctx?: ParseContext): AsyncIterable<TRecord>;
  load(records: AsyncIterable<TRecord>, ctx: LoadContext): Promise<LoadCounts>;
}

export interface ShrinkDataset {
  /** SQL table the counter loads; it must have `source_id` (and `scopeColumn`, if set). */
  table: string;
  /** Receipt counter: rows this run inserted or updated in `table`. */
  loaded: string;
  /** Receipt counter: rows the stale-row sweep deleted from `table` (swept tables only). */
  swept?: string;
  /** Column holding the run's scope value; unset = the source's rows in every scope. */
  scopeColumn?: 'cycle' | 'congress';
  /** For a child table without a scope column: `column` references `table`, which has one. */
  scopeVia?: { column: string; table: string; scopeColumn: 'cycle' | 'congress' };
}

/** Byte caps for raw input (DECISIONS A53); a breach fails the run. */
export interface IngestLimits {
  /** Per downloaded file. */
  maxDownloadBytes: number;
  /** Per inflated zip entry. */
  maxDecompressedBytes: number;
}

export interface ParseContext {
  signal?: AbortSignal;
  limits?: IngestLimits;
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  url: string;
  license: string;
  licenseUrl: string | null;
  description: string;
}

export interface PlanContext {
  /** Repository root; curated data lives under `<repoRoot>/data/curated`. */
  repoRoot: string;
  /** When set, the snapshot is read from this directory instead of fetched. */
  snapshotPath?: string;
  signal?: AbortSignal;
}

export interface FetchPlan {
  source: SourceId;
  scope: IngestScope;
  requests: FetchRequest[];
}

export interface FetchRequest {
  /** Relative path inside the snapshot directory (may contain `/`). */
  fileName: string;
  /** Remote file. Exactly one of `url` / `localPath` is set. */
  url?: string;
  /** Local file copied into the snapshot (curated repo data). */
  localPath?: string;
  /** Whole-request timeout; large bulk files need more than the 30 s default. */
  timeoutMs?: number;
  /** Send a browser-like User-Agent (some government hosts reject others). */
  browserLike?: boolean;
  headers?: Record<string, string>;
  /** Env var holding the API key, if the endpoint needs one. Never logged. */
  apiKeyEnv?: 'CONGRESS_GOV_API_KEY' | 'FEC_API_KEY' | 'OPENSTATES_API_KEY';
}

export interface FetchContext {
  rawDir: string;
  logger: Logger;
  signal: AbortSignal;
  maxDownloadBytes?: number;
}

export interface SnapshotFile {
  fileName: string;
  sha256: string;
  bytes: number;
}

export interface RawSnapshot {
  source: SourceId;
  directory: string;
  files: SnapshotFile[];
  /** Latest successful run id per dependency at fetch time (null = never loaded). */
  upstream: Record<string, number | null>;
  /** sha256 of the canonical manifest (file checksums + upstream runs): the dedupe half. */
  checksum: string;
  retrievedAt: Date;
}

export interface LoadContext {
  db: Db;
  sourceId: SourceId;
  ingestRunId: number;
  retrievedAt: Date;
  scope: IngestScope;
  logger: Logger;
  /** The run's cancellation signal; loaders may check it between batches. */
  signal?: AbortSignal;
  /**
   * The run's cancellation checkpoint (`RunControl.checkpoint`, DECISIONS A52): throws when
   * the operator aborted, the deadline passed or the source lock was lost. Loaders with
   * multi-statement phases call it before each statement (the FEC staging, dedupe, page
   * and sweep statements). Absent outside a run; loaders then check `signal`.
   */
  checkpoint?: () => void;
}

/** Rows upserted (and anomaly counters) per table, recorded on the ingest_run receipt. */
export type LoadCounts = Record<string, number>;
