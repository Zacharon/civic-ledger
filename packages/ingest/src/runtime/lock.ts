import type { DbHandle } from '@civic-ledger/db';

/** First key of the two-key advisory lock; the second is hashtext(source id). */
const LOCK_NAMESPACE = 20261016;

export interface SourceLock {
  /** Aborts if the connection holding the lock fails: the lock is gone and the run must stop. */
  signal: AbortSignal;
  release(): Promise<void>;
}

/** PGlite is one in-process connection, where advisory locks are re-entrant: track holders here. */
const pgliteHolders = new WeakMap<object, Set<string>>();

/**
 * Per-source run lock (VC-021, VC-039). On Postgres this is a session advisory lock held
 * on a dedicated pooled connection for the whole run, so it also excludes runs in other
 * processes and is released automatically if this process dies. On PGlite (single
 * process, single connection) an in-process registry gives the same exclusion.
 * Returns null when another run holds the lock.
 */
export async function tryAcquireSourceLock(
  handle: DbHandle,
  sourceId: string,
): Promise<SourceLock | null> {
  if (handle.kind === 'pglite') {
    const held = pgliteHolders.get(handle.client) ?? new Set<string>();
    pgliteHolders.set(handle.client, held);
    if (held.has(sourceId)) return null;
    held.add(sourceId);
    return {
      signal: new AbortController().signal,
      release: async () => {
        held.delete(sourceId);
      },
    };
  }

  const client = await handle.pool.connect();
  const lost = new AbortController();
  // A checked-out client has no pool error listener; unhandled, a dropped connection would
  // crash the process. Either way the lock is gone, so the run is told to stop.
  const onError = (error: Error) =>
    lost.abort(new Error(`source lock connection lost: ${error.message}`));
  client.on('error', onError);
  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1, hashtext($2)) as locked',
      [LOCK_NAMESPACE, sourceId],
    );
    if (!result.rows[0]?.locked) {
      client.removeListener('error', onError);
      client.release();
      return null;
    }
  } catch (error) {
    client.removeListener('error', onError);
    client.release(error instanceof Error ? error : true);
    throw error;
  }
  return {
    signal: lost.signal,
    release: async () => {
      // A connection that failed to unlock is destroyed so the pool never reuses it.
      let broken = lost.signal.aborted;
      try {
        if (!broken) {
          await client.query('select pg_advisory_unlock($1, hashtext($2))', [
            LOCK_NAMESPACE,
            sourceId,
          ]);
        }
      } catch {
        broken = true;
      } finally {
        client.removeListener('error', onError);
        client.release(broken);
      }
    },
  };
}
