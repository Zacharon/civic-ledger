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
 * - load: batched, idempotent upserts on natural keys, one transaction per batch, every
 *   row stamped with provenance (source_id, source_key, ingest_run_id, retrieved_at).
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
  plan(scope: IngestScope, ctx: PlanContext): Promise<FetchPlan>;
  parse(snapshot: RawSnapshot, scope: IngestScope): AsyncIterable<TRecord>;
  load(records: AsyncIterable<TRecord>, ctx: LoadContext): Promise<LoadCounts>;
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
}

/** Rows upserted (and anomaly counters) per table, recorded on the ingest_run receipt. */
export type LoadCounts = Record<string, number>;
