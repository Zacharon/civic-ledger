import type { IngestScope, SourceId } from '@civic-ledger/core';
import type { Db } from '@civic-ledger/db';
import type { Logger } from 'pino';

/**
 * Source adapter contract (ARCHITECTURE §4). Rules every adapter must follow:
 * - fetch: 30 s timeout per request (AbortSignal.timeout), at most 3 retries with
 *   exponential backoff + full jitter, on 429/5xx/network errors only; raw files are
 *   written under data/raw and checksummed.
 * - parse: streaming; never buffer a whole large CSV/XML/ZIP in memory.
 * - load: batched, idempotent upserts on natural keys, one transaction per batch,
 *   every row stamped with provenance (source_id, source_key, ingest_run_id, retrieved_at).
 */
export interface SourceAdapter<TRecord> {
  id: SourceId;
  /** Part of the dedupe key (source, version, snapshot checksum). Bump on parser/loader changes. */
  version: string;
  license: { summary: string; url: string };
  plan(scope: IngestScope): FetchPlan;
  fetch(plan: FetchPlan, ctx: FetchContext): Promise<RawSnapshot>;
  parse(snapshot: RawSnapshot): AsyncIterable<TRecord>;
  load(records: AsyncIterable<TRecord>, tx: Db, run: LoadRun): Promise<LoadCounts>;
}

export interface FetchPlan {
  source: SourceId;
  scope: IngestScope;
  requests: FetchRequest[];
}

export interface FetchRequest {
  url: string;
  /** File name under the run's raw snapshot directory. */
  fileName: string;
  /** Env var holding the API key, if the endpoint needs one. Never logged. */
  apiKeyEnv?: 'CONGRESS_GOV_API_KEY' | 'FEC_API_KEY' | 'OPENSTATES_API_KEY';
}

export interface FetchContext {
  rawDir: string;
  logger: Logger;
  signal: AbortSignal;
}

export interface RawSnapshot {
  source: SourceId;
  directory: string;
  files: { fileName: string; sha256: string; bytes: number }[];
  /** sha256 over the sorted file checksums; the snapshot half of the dedupe key. */
  checksum: string;
  retrievedAt: Date;
}

export interface LoadRun {
  ingestRunId: number;
  retrievedAt: Date;
  logger: Logger;
}

/** Rows upserted per table, recorded on the ingest_run receipt. */
export type LoadCounts = Record<string, number>;
