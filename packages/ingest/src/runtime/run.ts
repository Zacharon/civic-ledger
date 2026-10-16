import { resolve } from 'node:path';
import {
  CapabilityError,
  formatIngestScope,
  IngestRunInputSchema,
  type IngestRunReceipt,
  invalidInput,
  RUN_IN_PROGRESS,
  type SourceId,
} from '@civic-ledger/core';
import { type Db, type DbHandle, refreshPersonCard } from '@civic-ledger/db';
import type { Logger } from 'pino';
import type { SourceAdapter } from '../adapter';
import type { HttpDeps } from './http';
import {
  deleteRun,
  ensureSource,
  findSucceededRun,
  latestSucceededRunIds,
  readModelRefreshedAt,
  reapAbandonedRuns,
  startRun,
  toReceipt,
  updateRun,
} from './ledger';
import { tryAcquireSourceLock } from './lock';
import { fetchSnapshot, snapshotFromDirectory } from './snapshot';

export type AdapterRegistry = Partial<Record<SourceId, SourceAdapter<unknown>>>;

export interface IngestRuntime {
  handle: DbHandle;
  adapters: AdapterRegistry;
  logger: Logger;
  /** Root for raw snapshots, normally `<repo>/data/raw`. */
  rawRoot: string;
  repoRoot: string;
  http?: HttpDeps;
  signal?: AbortSignal;
  refreshReadModel?: (db: Db) => Promise<void>;
}

/**
 * `ingest.run@1` (CAPABILITIES.md "Write semantics"). Order of effects:
 * 1. take the per-source lock, or refuse with `conflict: run_in_progress`;
 * 2. write the ledger row (`running`) before any fetch, so every attempt leaves a receipt;
 * 3. fetch the snapshot; if (source, adapterVersion, snapshotChecksum) already succeeded,
 *    drop the provisional row and return the original run (`deduplicated: true`);
 * 4. load in batched transactions; refresh read models only after the whole load succeeds;
 * 5. record the outcome. A failure is a `failed` receipt (committed batches stay valid
 *    upserts; a rerun converges), not an exception.
 */
export async function runIngest(rawInput: unknown, rt: IngestRuntime): Promise<IngestRunReceipt> {
  const parsed = IngestRunInputSchema.safeParse(rawInput);
  if (!parsed.success) throw invalidInput(parsed.error);
  const input = parsed.data;
  const adapter = rt.adapters[input.source];
  if (!adapter) {
    throw new CapabilityError(
      'invalid_input',
      `No ingest adapter for source "${input.source}" yet`,
    );
  }
  if (!adapter.scopes.includes(input.scope.kind)) {
    throw new CapabilityError(
      'invalid_input',
      `Source "${input.source}" takes a ${adapter.scopes.join(' or ')} scope, not "${input.scope.kind}"`,
    );
  }

  const db = rt.handle.db;
  await ensureSource(db, adapter.source);
  const lock = await tryAcquireSourceLock(rt.handle, input.source);
  if (!lock) {
    throw new CapabilityError(
      'conflict',
      `${RUN_IN_PROGRESS}: another "${input.source}" ingest run holds the source lock`,
    );
  }

  try {
    const reaped = await reapAbandonedRuns(db, input.source);
    const run = await startRun(db, {
      sourceId: input.source,
      adapterVersion: adapter.version,
      scope: formatIngestScope(input.scope),
    });
    const log = rt.logger.child({ runId: run.id, source: input.source, scope: run.scope });
    if (reaped > 0) log.warn({ reaped }, 'marked abandoned running rows as failed');
    log.info({ adapterVersion: adapter.version }, 'ingest run started');
    const started = performance.now();

    try {
      const plan = await adapter.plan(input.scope, {
        repoRoot: rt.repoRoot,
        snapshotPath: input.snapshotPath,
      });
      const upstream = await latestSucceededRunIds(db, adapter.dependsOn);
      const snapshot = input.snapshotPath
        ? await snapshotFromDirectory(plan, resolve(input.snapshotPath), upstream)
        : await fetchSnapshot(
            plan,
            {
              rawDir: rt.rawRoot,
              logger: log,
              signal: rt.signal ?? new AbortController().signal,
            },
            upstream,
            rt.http,
          );
      log.info(
        {
          checksum: snapshot.checksum,
          directory: snapshot.directory,
          files: snapshot.files.length,
        },
        'snapshot ready',
      );

      const original = await findSucceededRun(db, {
        sourceId: input.source,
        adapterVersion: adapter.version,
        snapshotChecksum: snapshot.checksum,
      });
      if (original) {
        await deleteRun(db, run.id);
        log.info({ originalRunId: original.id }, 'snapshot already loaded; returning original run');
        return toReceipt(original, true);
      }

      await updateRun(db, run.id, { snapshotChecksum: snapshot.checksum });
      const counts = await adapter.load(adapter.parse(snapshot, input.scope), {
        db,
        sourceId: input.source,
        ingestRunId: run.id,
        retrievedAt: snapshot.retrievedAt,
        scope: input.scope,
        logger: log,
      });
      const before = await readModelRefreshedAt(db);
      await (rt.refreshReadModel ?? refreshPersonCard)(db);
      const after = await readModelRefreshedAt(db);
      const done = await updateRun(db, run.id, {
        status: 'succeeded',
        finishedAt: new Date(),
        counts: integerCounts(counts),
        readModelRefreshedBefore: before,
        readModelRefreshedAfter: after,
      });
      log.info(
        { counts: done.counts, ms: Math.round(performance.now() - started) },
        'ingest run succeeded',
      );
      return toReceipt(done, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error, ms: Math.round(performance.now() - started) }, 'ingest run failed');
      const failed = await updateRun(db, run.id, {
        status: 'failed',
        finishedAt: new Date(),
        error: message.slice(0, 4_000),
      });
      return toReceipt(failed, false);
    }
  } finally {
    await lock.release();
  }
}

function integerCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isInteger(value)) throw new Error(`Count "${key}" is not an integer: ${value}`);
    out[key] = value;
  }
  return out;
}
