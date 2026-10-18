import { resolve } from 'node:path';
import {
  CapabilityError,
  formatIngestScope,
  type IngestRunInput,
  IngestRunInputSchema,
  type IngestRunReceipt,
  invalidInput,
  RUN_IN_PROGRESS,
  SNAPSHOT_SUPERSEDED,
  type SourceId,
} from '@civic-ledger/core';
import { type Db, type DbHandle, refreshPersonCard } from '@civic-ledger/db';
import type { Logger } from 'pino';
import type { IngestLimits, RawSnapshot, SourceAdapter } from '../adapter';
import { abortable, RunControl } from './cancel';
import { describeError } from './errors';
import type { HttpDeps } from './http';
import {
  deleteRun,
  ensureSource,
  findSucceededRun,
  finishRun,
  latestSucceededRun,
  latestSucceededRunIds,
  readModelRefreshedAt,
  reapAbandonedRuns,
  startRun,
  toReceipt,
  updateRun,
} from './ledger';
import { DEFAULT_LIMITS } from './limits';
import { tryAcquireSourceLock } from './lock';
import {
  countDatasetRows,
  countSourceRows,
  DEFAULT_SHRINK_GUARD,
  evaluateShrink,
  previousRunCounts,
  type ShrinkGuardConfig,
  ShrinkGuardError,
} from './shrink-guard';
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
  /** Operator cancellation (the CLI aborts it on SIGINT). */
  signal?: AbortSignal;
  /** Optional whole-run deadline; past it the run stops as `cancelled` (DECISIONS A52). */
  deadlineMs?: number;
  /** Called inside the load transaction; defaults to refreshing both read models. */
  refreshReadModel?: (db: Db) => Promise<void>;
  /** Truncation guard thresholds and the `--allow-shrink` override. */
  shrinkGuard?: ShrinkGuardConfig;
  /** Byte caps for downloads and inflated zip entries (DECISIONS A53). */
  limits?: Partial<IngestLimits>;
}

type RunRow = Parameters<typeof toReceipt>[0];

/**
 * `ingest.run@1` (CAPABILITIES.md "Write semantics"). Order of effects:
 * 1. upsert the source's metadata row, take the per-source lock or refuse with
 *    `conflict: run_in_progress`;
 * 2. write the ledger row (`running`) before any fetch, so every attempt leaves a receipt;
 * 3. fetch or hash the snapshot; a key equal to the current generation (the latest
 *    successful run of this scope, forced replays included) returns that run
 *    (`deduplicated: true`); a key that succeeded earlier but was superseded is refused
 *    unless `forceReplay` (DECISIONS A54);
 * 4. ONE transaction (DECISIONS A50): load (adapter batches are savepoints), shrink guard,
 *    refresh both read models, write the `succeeded` receipt. Facts, read models and
 *    receipt commit together or not at all; the commit is the only irrevocable step;
 * 5. any failure or cancellation before the commit rolls all of it back and records a
 *    `failed` or `cancelled` receipt, not an exception.
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
  if (adapter.guardShrink !== false && !adapter.shrinkDatasets?.length) {
    throw new Error(`Adapter ${adapter.version} is guarded but declares no shrinkDatasets`);
  }

  const db: Db = rt.handle.db;
  await ensureSource(db, adapter.source);
  const lock = await tryAcquireSourceLock(rt.handle, input.source);
  if (!lock) {
    throw new CapabilityError(
      'conflict',
      `${RUN_IN_PROGRESS}: another "${input.source}" ingest run holds the source lock`,
    );
  }
  const control = new RunControl(rt.signal, lock.signal, rt.deadlineMs);

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
      const snapshot = await takeSnapshot(adapter, input, rt, control, log, db);
      log.info(
        {
          checksum: snapshot.checksum,
          directory: snapshot.directory,
          files: snapshot.files.length,
        },
        'snapshot ready',
      );
      const key = {
        sourceId: input.source,
        adapterVersion: adapter.version,
        snapshotChecksum: snapshot.checksum,
      };
      // The current generation decides idempotency (DECISIONS A54, H3R2-01): a key equal to
      // the latest successful run of this scope returns that run, even when it was a
      // forced replay; the earliest run of the key is only the replay lineage (`replayOf`).
      const current = await latestSucceededRun(db, input.source, run.scope);
      const original = await findSucceededRun(db, key);
      if (!input.forceReplay) {
        // With no success in this scope yet, an earlier run of the key is returned as before.
        const loaded = current ? (sameSnapshot(current, key) ? current : null) : original;
        if (loaded) {
          await deleteRun(db, run.id);
          log.info({ currentRunId: loaded.id }, 'snapshot already loaded; returning current run');
          return toReceipt(loaded, true);
        }
      }
      if (original && current && !input.forceReplay) {
        const refused = await finishRun(db, run.id, {
          status: 'failed',
          finishedAt: new Date(),
          snapshotChecksum: snapshot.checksum,
          error:
            `${SNAPSHOT_SUPERSEDED}: this snapshot was loaded by run ${original.id}, but run ${current.id} ` +
            `has loaded other data for ${run.scope} since. Replaying it is not a restore; nothing was ` +
            'changed. To load it again as a new run, rerun with --force-replay.',
        });
        log.warn(
          { originalRunId: original.id, currentRunId: current.id },
          'superseded snapshot refused',
        );
        return toReceipt(refused, false);
      }

      await updateRun(db, run.id, { snapshotChecksum: snapshot.checksum });
      control.checkpoint();
      const done = await db.transaction((tx) =>
        loadAndPublish(tx, {
          adapter,
          input,
          rt,
          control,
          log,
          run,
          snapshot,
          replayOf: original?.id ?? null,
        }),
      );
      log.info(
        { counts: done.counts, ms: Math.round(performance.now() - started) },
        'ingest run succeeded',
      );
      return toReceipt(done, false);
    } catch (error) {
      const cancelled = control.cancellationReason();
      const message = cancelled
        ? `cancelled: ${cancelled}. Rolled back; nothing was committed.`
        : error instanceof ShrinkGuardError
          ? error.message
          : `${describeError(error)} (rolled back: no facts, read models or counts were committed)`;
      log.error(
        { err: error, ms: Math.round(performance.now() - started) },
        cancelled ? 'ingest run cancelled' : 'ingest run failed',
      );
      const finished = await finishRun(db, run.id, {
        status: cancelled ? 'cancelled' : 'failed',
        finishedAt: new Date(),
        error: message.slice(0, 4_000),
      });
      return toReceipt(finished, false);
    }
  } finally {
    control.dispose();
    await lock.release();
  }
}

async function takeSnapshot(
  adapter: SourceAdapter<unknown>,
  input: IngestRunInput,
  rt: IngestRuntime,
  control: RunControl,
  log: Logger,
  db: Db,
): Promise<RawSnapshot> {
  control.checkpoint();
  const plan = await adapter.plan(input.scope, {
    repoRoot: rt.repoRoot,
    snapshotPath: input.snapshotPath,
    signal: control.signal,
  });
  control.checkpoint();
  const upstream = await latestSucceededRunIds(db, adapter.dependsOn);
  const snapshot = input.snapshotPath
    ? await snapshotFromDirectory(plan, resolve(input.snapshotPath), upstream, control.signal)
    : await fetchSnapshot(
        plan,
        {
          rawDir: rt.rawRoot,
          logger: log,
          signal: control.signal,
          maxDownloadBytes: rt.limits?.maxDownloadBytes ?? DEFAULT_LIMITS.maxDownloadBytes,
        },
        upstream,
        rt.http,
      );
  control.checkpoint();
  return snapshot;
}

interface PublishArgs {
  adapter: SourceAdapter<unknown>;
  input: IngestRunInput;
  rt: IngestRuntime;
  control: RunControl;
  log: Logger;
  run: RunRow & { id: number; scope: string };
  snapshot: RawSnapshot;
  replayOf: number | null;
}

/** Runs inside the load transaction: everything here commits together or rolls back. */
async function loadAndPublish(tx: Db, a: PublishArgs): Promise<RunRow> {
  const { adapter, input, control, run } = a;
  const guarded = adapter.guardShrink !== false;
  const datasets = adapter.shrinkDatasets ?? [];
  const existingRows = guarded ? await countSourceRows(tx, input.source) : 0;
  const existing = guarded ? await countDatasetRows(tx, input.source, input.scope, datasets) : [];
  const limits = { ...DEFAULT_LIMITS, ...a.rt.limits };
  const records = adapter.parse(a.snapshot, input.scope, { signal: control.signal, limits });
  const counts = integerCounts(
    await adapter.load(abortable(records, control), {
      db: tx,
      sourceId: input.source,
      ingestRunId: run.id,
      retrievedAt: a.snapshot.retrievedAt,
      scope: input.scope,
      logger: a.log,
      signal: control.signal,
      checkpoint: () => control.checkpoint(),
    }),
  );
  control.checkpoint();

  let note: string | null = null;
  if (guarded) {
    const guard = a.rt.shrinkGuard ?? DEFAULT_SHRINK_GUARD;
    const violation = evaluateShrink(
      {
        existingRows,
        counts,
        previous: await previousRunCounts(tx, input.source, input.scope),
        datasets: existing,
        scope: run.scope,
      },
      guard,
    );
    if (violation && !guard.allow) throw new ShrinkGuardError(violation);
    if (violation) {
      note = `shrink guard overridden (--allow-shrink): ${violation}`;
      a.log.warn({ violation }, 'shrink guard overridden by --allow-shrink');
    }
  }

  const before = await readModelRefreshedAt(tx);
  await (a.rt.refreshReadModel ?? refreshPersonCard)(tx);
  control.checkpoint();
  const after = await readModelRefreshedAt(tx);
  const done = await updateRun(tx, run.id, {
    status: 'succeeded',
    finishedAt: new Date(),
    counts,
    readModelRefreshedBefore: before,
    readModelRefreshedAfter: after,
    note,
    replayOf: a.replayOf,
  });
  // Last chance to cancel: past this line the commit makes the run irrevocable.
  control.checkpoint();
  return done;
}

/** True when `run` loaded exactly this idempotency key (same adapter version and snapshot). */
function sameSnapshot(
  run: RunRow,
  key: { sourceId: SourceId; adapterVersion: string; snapshotChecksum: string },
): boolean {
  return (
    run.sourceId === key.sourceId &&
    run.adapterVersion === key.adapterVersion &&
    run.snapshotChecksum === key.snapshotChecksum
  );
}

function integerCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isInteger(value)) throw new Error(`Count "${key}" is not an integer: ${value}`);
    out[key] = value;
  }
  return out;
}
