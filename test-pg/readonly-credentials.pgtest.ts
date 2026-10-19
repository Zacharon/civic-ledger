import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dispatchByName, publicCapabilities } from '@civic-ledger/core';
import { createDb, type DbHandle, dbConfigFromEnv } from '@civic-ledger/db';
import { seedDevData } from '@civic-ledger/db/seed';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type MigratedDatabase, migratedDatabase, rows, urlFor } from './helpers';

const ROLES_SQL = fileURLToPath(new URL('../scripts/db/roles.sql', import.meta.url));

let db: MigratedDatabase;
let readerUrl: string;

beforeAll(async () => {
  db = await migratedDatabase();
  await seedDevData(db.handle.db);
  const admin = new pg.Client({ connectionString: db.database.url });
  await admin.connect();
  try {
    await admin.query(await readFile(ROLES_SQL, 'utf8'));
    // Login role as OPERATIONS.md describes it; not created by roles.sql (no passwords in git).
    await admin.query(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'civic_web_ro') then
          create role civic_web_ro login password 'ro-pw' in role civic_readonly;
        end if;
      end $$;
      alter role civic_web_ro set default_transaction_read_only = on;`);
  } finally {
    await admin.end();
  }
  readerUrl = urlFor(inject('pgAdminUrl'), db.database.name, {
    name: 'civic_web_ro',
    password: 'ro-pw',
  });
});
afterAll(() => db?.cleanup());

async function withHandle<T>(url: string, run: (handle: DbHandle) => Promise<T>): Promise<T> {
  const handle = createDb({ kind: 'pg', url, poolMax: 2 });
  try {
    return await run(handle);
  } finally {
    await handle.close();
  }
}

async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause ?? error;
    return (cause as { code?: string }).code ?? 'unknown';
  }
}

/** VC-068 on a real role: the production configuration path ends on the select-only login. */
describe('production read-only credentials on Postgres 17', () => {
  const production = () => ({
    NODE_ENV: 'production',
    DATABASE_URL: db.database.url,
    DATABASE_URL_READONLY: readerUrl,
  });

  it('connects as the read-only login and serves every public capability', async () => {
    const config = dbConfigFromEnv(production(), { readOnly: true });
    if (config.kind !== 'pg') throw new Error('expected Postgres');
    await withHandle(config.url, async (handle) => {
      const who = await rows<{ user: string }>(handle, sql`select current_user as user`);
      expect(who[0]?.user).toBe('civic_web_ro');
      const ctx = { db: handle.db };
      const slug = 'avery-ashvale';
      const frameworks = (await dispatchByName('frameworks.list', {}, ctx)) as {
        items: Array<{ spec: unknown }>;
      };
      const inputs: Record<string, unknown> = {
        'people.get': { slug },
        'people.glance': { slug },
        'money.summary': { slug },
        'scores.list': { slug },
        'promises.list': { slug },
        'people.compare': { slugs: [slug, 'dana-dunmere'] },
        'frameworks.evaluate': { framework: frameworks.items[0]?.spec },
      };
      for (const { name } of publicCapabilities()) {
        await expect(
          dispatchByName(name, inputs[name] ?? {}, { db: handle.db }),
          name,
        ).resolves.toBeTruthy();
      }
    });
  });

  it('cannot write through that connection, even inside a read-write transaction', async () => {
    await withHandle(readerUrl, async (handle) => {
      expect(
        await sqlState(() => handle.db.execute(sql`update person set full_name = 'Changed'`)),
      ).toBe('25006');
      expect(
        await sqlState(() =>
          handle.db.transaction(async (tx) => {
            await tx.execute(sql`set transaction read write`);
            await tx.execute(sql`delete from person`);
          }),
        ),
      ).toBe('42501');
    });
    const untouched = await rows<{ n: number }>(
      db.handle,
      sql`select count(*)::int as n from person where full_name = 'Changed'`,
    );
    expect(untouched[0]?.n).toBe(0);
  });

  it('refuses to start on the owner URL unless acknowledged; acknowledged, it is the owner', async () => {
    const { DATABASE_URL_READONLY: _unused, ...ownerOnly } = production();
    expect(() => dbConfigFromEnv(ownerOnly, { readOnly: true })).toThrow(
      /DATABASE_URL_READONLY is not set/,
    );
    const acknowledged = dbConfigFromEnv(
      { ...ownerOnly, DB_ALLOW_OWNER_CREDENTIALS: '1' },
      { readOnly: true },
    );
    if (acknowledged.kind !== 'pg') throw new Error('expected Postgres');
    // The acknowledgement is exactly that: this connection could write. It is the risk the
    // startup check makes explicit.
    await withHandle(acknowledged.url, async (handle) => {
      const who = await rows<{ user: string }>(handle, sql`select current_user as user`);
      expect(who[0]?.user).not.toBe('civic_web_ro');
    });
  });
});
