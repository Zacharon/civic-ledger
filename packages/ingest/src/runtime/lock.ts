import type { DbHandle } from '@civic-ledger/db';

/** First key of the two-key advisory lock; the second is hashtext(source id). */
const LOCK_NAMESPACE = 20261016;

export interface SourceLock {
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
      release: async () => {
        held.delete(sourceId);
      },
    };
  }

  const client = await handle.pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1, hashtext($2)) as locked',
      [LOCK_NAMESPACE, sourceId],
    );
    if (!result.rows[0]?.locked) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }
  return {
    release: async () => {
      try {
        await client.query('select pg_advisory_unlock($1, hashtext($2))', [
          LOCK_NAMESPACE,
          sourceId,
        ]);
      } finally {
        client.release();
      }
    },
  };
}
