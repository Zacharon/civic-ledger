import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type IngestRuntime, runIngest } from '../src/runtime/run';
import { FIXTURES, freshDb, ingestFixture, rows, SCOPES, testRuntime } from './helpers';
import { MARKER, markedSnapshot } from './support/publication-scenarios';

/**
 * H3R2-01: after A -> B -> forced A, the current generation is the forced run, so an
 * ordinary retry of A must return that run (deduplicated), not refuse it as superseded.
 * A snapshot that really was superseded is still refused.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

const A = join(FIXTURES, 'congress-legislators');

const markerRows = async () => {
  const [row] = await rows<{ n: number }>(
    handle.db,
    sql`select count(*)::int as n from person where full_name = ${MARKER}`,
  );
  return row?.n ?? 0;
};

const runStatuses = async () =>
  rows<{ id: number; status: string }>(
    handle.db,
    sql`select id, status from ingest_run where source_id = 'congress-legislators' order by id`,
  );

const forceReplay = (rt: IngestRuntime) =>
  runIngest(
    {
      source: 'congress-legislators',
      scope: SCOPES['congress-legislators'],
      snapshotPath: A,
      forceReplay: true,
    },
    rt,
  );

/**
 * The same database, but the outer load transaction "loses" its acknowledgement: the real
 * transaction commits, then the caller sees an error (as if the connection dropped).
 */
function lostAckHandle(base: DbHandle): DbHandle {
  const db = new Proxy(base.db, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          throw new Error('injected: commit acknowledgement lost');
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...base, db } as DbHandle;
}

describe('retry after a forced replay (H3R2-01)', () => {
  it('A -> B -> forced A -> A deduplicates to the forced run', async () => {
    const rt = await testRuntime(handle);
    const first = await ingestFixture(rt, 'congress-legislators', A);
    const b = await ingestFixture(rt, 'congress-legislators', await markedSnapshot());
    const forced = await forceReplay(rt);
    expect([first.status, b.status, forced.status]).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(forced.replayOf).toBe(first.runId);

    const retry = await ingestFixture(rt, 'congress-legislators', A);
    expect(retry.error).toBeNull();
    expect(retry).toEqual({ ...forced, deduplicated: true });
    expect(retry.replayOf).toBe(first.runId);
    expect(await markerRows()).toBe(0);
    // No new ledger row: the retry returned the current generation.
    expect((await runStatuses()).map((r) => r.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
  });

  it('a lost-response retry after a forced replay returns the current receipt', async () => {
    const rt = await testRuntime(handle);
    const first = await ingestFixture(rt, 'congress-legislators', A);
    await ingestFixture(rt, 'congress-legislators', await markedSnapshot());

    // The forced replay commits; its caller never learns the outcome.
    await forceReplay(await testRuntime(handle, { handle: lostAckHandle(handle) }));
    const [, , committed] = await runStatuses();
    expect(committed?.status).toBe('succeeded');

    // The caller retries the same snapshot normally.
    const retry = await ingestFixture(rt, 'congress-legislators', A);
    expect(retry).toMatchObject({
      runId: committed?.id,
      status: 'succeeded',
      deduplicated: true,
      replayOf: first.runId,
      error: null,
    });
    expect(await markerRows()).toBe(0);
  });

  it('still refuses a snapshot that a later run superseded (A -> B -> forced A -> B)', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators', A);
    const bDir = await markedSnapshot();
    const b = await ingestFixture(rt, 'congress-legislators', bDir);
    const forced = await forceReplay(rt);

    const staleB = await ingestFixture(rt, 'congress-legislators', bDir);
    expect(staleB.deduplicated).toBe(false);
    expect(staleB.status).toBe('failed');
    expect(staleB.error).toMatch(
      new RegExp(
        `^snapshot_superseded: .*run ${b.runId}, but run ${forced.runId} .*--force-replay`,
        's',
      ),
    );
    expect(await markerRows()).toBe(0);
  });
});
