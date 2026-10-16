import { randomBytes } from 'node:crypto';
import { createDb, type DbHandle } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import type { sql } from 'drizzle-orm';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  name: string;
  /** Superuser connection string for this database. */
  url: string;
  drop(): Promise<void>;
}

export function urlFor(
  adminUrl: string,
  database: string,
  user?: { name: string; password: string },
): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

/** A fresh, empty database on the shared server; each test file owns one. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl');
  const name = `civic_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  return {
    name,
    url: urlFor(adminUrl, name),
    drop: async () => {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      try {
        await client.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await client.end();
      }
    },
  };
}

export interface MigratedDatabase {
  database: TestDatabase;
  handle: DbHandle;
  cleanup(): Promise<void>;
}

/** A migrated pg handle on its own database. `cleanup` closes the pool and drops the database. */
export async function migratedDatabase(): Promise<MigratedDatabase> {
  const database = await createTestDatabase();
  const handle = createDb({ kind: 'pg', url: database.url, poolMax: 8 });
  await runMigrations(handle);
  return {
    database,
    handle,
    cleanup: async () => {
      await handle.close();
      await database.drop();
    },
  };
}

export async function rows<T>(handle: DbHandle, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await handle.db.execute(query)) as unknown as { rows: T[] }).rows;
}
