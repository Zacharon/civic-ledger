import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelledReload,
  fecBoundaryScenarios,
  publicState,
} from '../packages/ingest/test/support/fec-boundary-scenarios';
import { type MigratedDatabase, migratedDatabase, rows } from './helpers';

/**
 * H3R3 (H3R2-02 residual) on real Postgres: the same boundary scenarios as the PGlite
 * suite (packages/ingest/test/cancellation-fec-boundaries.test.ts), plus a lost source
 * lock at the new boundaries, which must stay `failed` rather than `cancelled`.
 */
let db: MigratedDatabase;
beforeAll(async () => {
  db = await migratedDatabase();
});
afterAll(() => db.cleanup());

const advisoryLocks = () =>
  rows<{ pid: number }>(
    db.handle,
    sql`select pid from pg_locks where locktype = 'advisory' and classid = 20261016 and granted`,
  );

/** Kills the backend holding the run's source lock and waits until the lock is gone. */
async function killLock(): Promise<void> {
  const [holder] = await advisoryLocks();
  if (!holder) throw new Error('no source lock held');
  await db.handle.db.execute(sql`select pg_terminate_backend(${holder.pid})`);
  for (let i = 0; i < 200 && (await advisoryLocks()).length > 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // The pg client reports the terminated connection asynchronously; let it arrive.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

describe('FEC cancellation at every loader statement boundary (Postgres)', () => {
  fecBoundaryScenarios(() => db.handle);

  const lostLockCases: [string, RegExp][] = [
    ['the pas2 initial stage DROP', /^execute: drop table if exists fec_pas2_stage/],
    ['the first sweep DELETE', /^delete committee_contribution$/],
  ];
  for (const [name, pattern] of lostLockCases) {
    it(`a lost source lock right after ${name} stops the loader and stays failed`, async () => {
      const baseline = await publicState(db.handle);
      let seen = false;
      const { receipt, rec } = await cancelledReload(db.handle, {
        when: (what) => {
          if (seen || !pattern.test(what)) return false;
          seen = true;
          return true;
        },
        action: killLock,
      });
      expect(rec.fired).toBe(true);
      expect(rec.afterAbort).toEqual([]);
      expect(receipt.status).toBe('failed');
      expect(receipt.error).toMatch(/source lock connection lost/);
      expect(await publicState(db.handle)).toEqual(baseline);
    });
  }
});
