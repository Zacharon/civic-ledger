import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dispatchByName } from '@civic-ledger/core';
import { createDb, dbConfigFromEnv, refreshPersonCard } from '@civic-ledger/db';
import { seedDevData } from '@civic-ledger/db/seed';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ADAPTERS } from '../packages/ingest/src/adapters/registry';
import { ingestFixture, testRuntime } from '../packages/ingest/test/helpers';
import { type MigratedDatabase, migratedDatabase, urlFor } from './helpers';

const ROLES_SQL = fileURLToPath(new URL('../scripts/db/roles.sql', import.meta.url));

let db: MigratedDatabase;
let readerUrl: string;
let ingestUrl: string;

async function exec(url: string, statement: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(statement);
  } finally {
    await client.end();
  }
}

/** The SQLSTATE of a statement run as `url`, or null when it succeeds. */
async function failureCode(url: string, statement: string): Promise<string | null> {
  try {
    await exec(url, statement);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

beforeAll(async () => {
  db = await migratedDatabase();
  await seedDevData(db.handle.db);
  const script = await readFile(ROLES_SQL, 'utf8');
  await exec(db.database.url, script);
  // Re-running is part of the contract.
  await exec(db.database.url, script);
  await exec(
    db.database.url,
    `create role civic_web login password 'web-pw' in role civic_readonly;
     alter role civic_web set default_transaction_read_only = on;
     create role civic_loader login password 'loader-pw' in role civic_ingest;`,
  );
  const admin = inject('pgAdminUrl');
  readerUrl = urlFor(admin, db.database.name, { name: 'civic_web', password: 'web-pw' });
  ingestUrl = urlFor(admin, db.database.name, { name: 'civic_loader', password: 'loader-pw' });
});
afterAll(() => db?.cleanup());

describe('read-only role (web and MCP)', () => {
  it('reads tables, views and the materialized read model', async () => {
    for (const relation of ['person', 'ingest_run', 'person_card', 'person_card_scorecard']) {
      const result = await exec(readerUrl, `select count(*)::int as n from ${relation}`);
      expect(result.rows[0].n, relation).toBeGreaterThan(0);
    }
  });

  it('cannot write, truncate, refresh or change the schema, by privilege alone (42501)', async () => {
    const statements = [
      "insert into source (id, name, url, license, description) values ('x', 'x', 'https://x', 'x', 'x')",
      "update person set full_name = 'Changed'",
      'delete from person',
      'truncate person cascade',
      'refresh materialized view concurrently person_card',
      'create table scratch (id int)',
      'drop table person cascade',
      'alter table person add column nope int',
      'select * from drizzle.__drizzle_migrations',
    ];
    for (const statement of statements) {
      // `begin read write` defeats default_transaction_read_only: only grants are left.
      const code = await failureCode(readerUrl, `begin read write; ${statement}; commit;`);
      expect(code, statement).toBe('42501');
    }
  });

  it('refuses a plain write on the connection and changes nothing', async () => {
    const code = await failureCode(readerUrl, "update person set full_name = 'Changed'");
    expect(['25006', '42501']).toContain(code);
    const changed = await exec(
      db.database.url,
      "select count(*)::int as n from person where full_name = 'Changed'",
    );
    expect(changed.rows[0].n).toBe(0);
  });

  it('serves every public read capability through DATABASE_URL_READONLY', async () => {
    const config = dbConfigFromEnv(
      { DATABASE_URL: db.database.url, DATABASE_URL_READONLY: readerUrl },
      { readOnly: true },
    );
    expect(config).toMatchObject({ kind: 'pg', url: readerUrl });
    const handle = createDb(config);
    try {
      const status = await dispatchByName('sources.status', {}, { db: handle.db });
      expect(status).toBeTruthy();
      const people = (await dispatchByName('people.search', { limit: 3 }, { db: handle.db })) as {
        items: unknown[];
      };
      expect(people.items.length).toBe(3);
    } finally {
      await handle.close();
    }
  });
});

describe('ingest role', () => {
  it('writes rows and refreshes the read model, but cannot change the schema', async () => {
    const handle = createDb({ kind: 'pg', url: ingestUrl, poolMax: 4 });
    try {
      const rt = await testRuntime(handle, { adapters: ADAPTERS });
      const receipt = await ingestFixture(rt, 'congress-legislators');
      expect(receipt.error).toBeNull();
      expect(receipt.status).toBe('succeeded');
      await refreshPersonCard(handle.db);
    } finally {
      await handle.close();
    }
    for (const statement of [
      'create table scratch (id int)',
      'drop table person cascade',
      'truncate person cascade',
      'alter table person add column nope int',
    ]) {
      expect(await failureCode(ingestUrl, statement), statement).toBe('42501');
    }
  });

  it('the login roles inherit nothing beyond their group', async () => {
    const result = await exec(
      db.database.url,
      `select r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole from pg_roles r
        where r.rolname in ('civic_web', 'civic_loader', 'civic_readonly', 'civic_ingest')
          and (r.rolsuper or r.rolcreatedb or r.rolcreaterole)`,
    );
    expect(result.rows).toEqual([]);
  });
});
