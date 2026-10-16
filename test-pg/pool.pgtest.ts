import { createDb, dbConfigFromEnv } from '@civic-ledger/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type MigratedDatabase, migratedDatabase } from './helpers';

let db: MigratedDatabase;
beforeAll(async () => {
  db = await migratedDatabase();
});
afterAll(() => db?.cleanup());

async function setting(url: string, batch: boolean, name: string): Promise<string> {
  const handle = createDb(dbConfigFromEnv({ DATABASE_URL: url }, { batch }));
  try {
    if (handle.kind !== 'pg') throw new Error('expected pg');
    const result = await handle.pool.query(`show ${name}`);
    return result.rows[0][name];
  } finally {
    await handle.close();
  }
}

describe('pool limits on real Postgres', () => {
  it('gives interactive connections a 15 s statement timeout and ingest a 10 minute one', async () => {
    expect(await setting(db.database.url, false, 'statement_timeout')).toBe('15s');
    expect(await setting(db.database.url, true, 'statement_timeout')).toBe('10min');
    expect(await setting(db.database.url, false, 'lock_timeout')).toBe('30s');
    expect(await setting(db.database.url, false, 'idle_in_transaction_session_timeout')).toBe(
      '1min',
    );
    expect(await setting(db.database.url, true, 'idle_in_transaction_session_timeout')).toBe(
      '10min',
    );
  });

  it('cancels a statement that outlives the configured timeout (57014)', async () => {
    const handle = createDb({
      kind: 'pg',
      url: db.database.url,
      poolMax: 2,
      statementTimeoutMs: 200,
    });
    try {
      if (handle.kind !== 'pg') throw new Error('expected pg');
      const error = await handle.pool.query('select pg_sleep(5)').then(
        () => null,
        (e: unknown) => e as { code?: string },
      );
      expect(error?.code).toBe('57014');
    } finally {
      await handle.close();
    }
  });
});

describe('pool error listener', () => {
  const killIdleBackends = async () => {
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: db.database.url });
    await admin.connect();
    try {
      await admin.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()',
      );
    } finally {
      await admin.end();
    }
  };

  it('reports an idle connection failure to the handler instead of crashing, and recovers', async () => {
    const errors: Error[] = [];
    const handle = createDb({
      kind: 'pg',
      url: db.database.url,
      poolMax: 2,
      onError: (error) => errors.push(error),
    });
    try {
      if (handle.kind !== 'pg') throw new Error('expected pg');
      await handle.pool.query('select 1');
      await killIdleBackends();
      await expect.poll(() => errors.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(errors[0]?.message).toMatch(/terminat|shutdown/i);
      const again = await handle.pool.query('select 1 as ok');
      expect(again.rows[0].ok).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it('logs a JSON line to stderr by default', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const handle = createDb({ kind: 'pg', url: db.database.url, poolMax: 2 });
    try {
      if (handle.kind !== 'pg') throw new Error('expected pg');
      await handle.pool.query('select 1');
      await killIdleBackends();
      await expect
        .poll(
          () => write.mock.calls.some(([line]) => String(line).includes('database pool error')),
          {
            timeout: 10_000,
          },
        )
        .toBe(true);
    } finally {
      write.mockRestore();
      await handle.close();
    }
  });
});
