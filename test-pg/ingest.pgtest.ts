import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityError, RUN_IN_PROGRESS } from '@civic-ledger/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADAPTERS, PIPELINE_ORDER } from '../packages/ingest/src/adapters/registry';
import {
  curatedFixture,
  FIXTURES,
  ingestFixture,
  insertFictionalPerson,
  tableCounts,
  testRuntime,
} from '../packages/ingest/test/helpers';
import { type MigratedDatabase, migratedDatabase, rows } from './helpers';

/**
 * The ingest runtime on real Postgres: advisory locks on a pooled connection, one load
 * transaction with savepoints per batch, REFRESH MATERIALIZED VIEW CONCURRENTLY, and the
 * idempotency and shrink-guard behaviour the PGlite suite proves in process.
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

describe('full pipeline', () => {
  it('loads every source from fixtures and refreshes the read model concurrently', async () => {
    const rt = await testRuntime(db.handle);
    for (const source of PIPELINE_ORDER) {
      if (source === 'curated') await insertFictionalPerson(db.handle.db);
      const receipt = await ingestFixture(
        rt,
        source,
        source === 'curated' ? await curatedFixture() : undefined,
      );
      expect(receipt.error, `${source}: ${receipt.error}`).toBeNull();
      expect(receipt.status).toBe('succeeded');
      expect(receipt.deduplicated).toBe(false);
    }
    const [cards] = await rows<{ n: number }>(
      db.handle,
      sql`select count(*)::int as n from person_card`,
    );
    expect(cards?.n).toBeGreaterThan(0);
    expect(await advisoryLocks()).toEqual([]);
  });

  it('returns the original run for an unchanged snapshot and writes nothing', async () => {
    const rt = await testRuntime(db.handle);
    const before = await tableCounts(db.handle.db);
    const again = await ingestFixture(rt, 'congress-legislators');
    expect(again.deduplicated).toBe(true);
    expect(await tableCounts(db.handle.db)).toEqual(before);
  });

  it('converges on natural keys when the same data is loaded under a new adapter version', async () => {
    const before = await tableCounts(db.handle.db);
    const bumped = await testRuntime(db.handle, {
      adapters: {
        ...ADAPTERS,
        'fec-bulk': { ...ADAPTERS['fec-bulk'], version: 'fec-bulk@pg-test' },
      },
    });
    const receipt = await ingestFixture(bumped, 'fec-bulk');
    expect(receipt.status).toBe('succeeded');
    expect(receipt.deduplicated).toBe(false);
    const after = await tableCounts(db.handle.db);
    expect({ ...after, ingest_run: 0 }).toEqual({ ...before, ingest_run: 0 });
  });
});

describe('advisory locks across connections', () => {
  const gated = async (handle: MigratedDatabase['handle'], version: string) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = ADAPTERS['congress-legislators'];
    const rt = await testRuntime(handle, {
      adapters: {
        ...ADAPTERS,
        'congress-legislators': {
          ...slow,
          version,
          plan: async (scope, ctx) => {
            await gate;
            return slow.plan(scope, ctx);
          },
        },
      },
    });
    return { rt, release };
  };

  it('refuses a concurrent run on another pool with conflict: run_in_progress', async () => {
    const { createDb } = await import('@civic-ledger/db');
    const second = createDb({ kind: 'pg', url: db.database.url, poolMax: 2 });
    try {
      const { rt, release } = await gated(db.handle, 'congress-legislators@lock-test-1');
      const first = ingestFixture(rt, 'congress-legislators');
      await expect.poll(async () => (await advisoryLocks()).length).toBe(1);

      const refused = await ingestFixture(await testRuntime(second), 'congress-legislators').then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(CapabilityError);
      expect((refused as CapabilityError).message.startsWith(RUN_IN_PROGRESS)).toBe(true);

      // A different source is not blocked by the held lock.
      const other = await ingestFixture(await testRuntime(second), 'voteview');
      expect(other.status).toBe('succeeded');

      release();
      expect((await first).status).toBe('succeeded');
      expect(await advisoryLocks()).toEqual([]);
    } finally {
      await second.close();
    }
  });

  it('stops a run whose lock connection was killed, without crashing the process', async () => {
    const { rt, release } = await gated(db.handle, 'congress-legislators@lock-test-2');
    const run = ingestFixture(rt, 'congress-legislators');
    await expect.poll(async () => (await advisoryLocks()).length).toBe(1);
    const [holder] = await advisoryLocks();
    await db.handle.db.execute(sql`select pg_terminate_backend(${holder?.pid})`);
    await expect.poll(async () => (await advisoryLocks()).length, { timeout: 10_000 }).toBe(0);
    release();
    const receipt = await run;
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/source lock connection lost/);
    // The pool recovers: the next run takes the lock and succeeds.
    const next = await ingestFixture(await testRuntime(db.handle), 'voteview');
    expect(next.status).toBe('succeeded');
  });

  it('marks a running row left by a dead process as failed before the next run', async () => {
    await db.handle.db.execute(
      sql`insert into ingest_run (source_id, adapter_version, scope) values ('voteview', 'abandoned-pg', 'congress:119')`,
    );
    const rt = await testRuntime(db.handle);
    await ingestFixture(rt, 'voteview');
    const [stale] = await rows<{ status: string; error: string }>(
      db.handle,
      sql`select status, error from ingest_run where adapter_version = 'abandoned-pg'`,
    );
    expect(stale).toMatchObject({ status: 'failed', error: expect.stringMatching(/^abandoned/) });
  });
});

describe('shrink guard on Postgres', () => {
  it('rolls back a truncated upstream file and leaves every row in place', async () => {
    const rt = await testRuntime(db.handle);
    const before = await tableCounts(db.handle.db);
    const empty = await mkdtemp(join(tmpdir(), 'civic-empty-legislators-'));
    await cp(join(FIXTURES, 'congress-legislators'), empty, { recursive: true });
    await writeFile(join(empty, 'legislators-current.json'), '[]');
    await writeFile(join(empty, 'legislators-historical.json'), '[]');

    const receipt = await ingestFixture(rt, 'congress-legislators', empty);

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard:/);
    const after = await tableCounts(db.handle.db);
    expect({ ...after, ingest_run: 0 }).toEqual({ ...before, ingest_run: 0 });
    expect(await advisoryLocks()).toEqual([]);
  });
});
