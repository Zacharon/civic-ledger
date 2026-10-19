import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type DbConfig, dbConfigFromEnv } from '@civic-ledger/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type MigratedDatabase, migratedDatabase, urlFor } from './helpers';

/**
 * T-O O1 on a real server: what a login placed in DATABASE_URL_READONLY can actually do decides
 * whether a production read-only consumer may use it (A61 gap: a writable role there was not
 * detected). Disposable logins with random names; dropped after the database.
 */
// Loaded per test so the baseline characterization below runs even before the module exists.
const attestation = () => import('../packages/db/src/readonly-attestation');

const ROLES_SQL = fileURLToPath(new URL('../scripts/db/roles.sql', import.meta.url));
const suffix = randomBytes(4).toString('hex');
const LOGINS = {
  owner: `att_owner_${suffix}`,
  loader: `att_loader_${suffix}`,
  reader: `att_reader_${suffix}`,
  readerNoDefault: `att_reader_nd_${suffix}`,
} as const;
const PASSWORD = `pw-${suffix}`;

let db: MigratedDatabase;
const urls = {} as Record<keyof typeof LOGINS | 'superuser', string>;

async function exec(url: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  db = await migratedDatabase();
  await exec(db.database.url, await readFile(ROLES_SQL, 'utf8'));
  await exec(
    db.database.url,
    `create role ${LOGINS.owner} login password '${PASSWORD}';
     create role ${LOGINS.loader} login password '${PASSWORD}' in role civic_ingest;
     alter role ${LOGINS.loader} set default_transaction_read_only = on;
     create role ${LOGINS.reader} login password '${PASSWORD}' in role civic_readonly;
     alter role ${LOGINS.reader} set default_transaction_read_only = on;
     create role ${LOGINS.readerNoDefault} login password '${PASSWORD}' in role civic_readonly;
     do $$ declare t record; begin
       for t in select tablename from pg_tables where schemaname = 'public' loop
         execute format('alter table public.%I owner to ${LOGINS.owner}', t.tablename);
       end loop;
     end $$;`,
  );
  const admin = inject('pgAdminUrl');
  urls.superuser = db.database.url;
  for (const [key, name] of Object.entries(LOGINS)) {
    urls[key as keyof typeof LOGINS] = urlFor(admin, db.database.name, {
      name,
      password: PASSWORD,
    });
  }
});

afterAll(async () => {
  await db?.cleanup();
  const admin = new pg.Client({ connectionString: inject('pgAdminUrl') });
  await admin.connect();
  try {
    for (const name of Object.values(LOGINS)) await admin.query(`drop role if exists ${name}`);
  } finally {
    await admin.end();
  }
});

/** The production configuration path: the login sits in DATABASE_URL_READONLY. */
function productionConfig(readOnlyUrl: string, extra: Record<string, string> = {}) {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: urls.superuser,
    DATABASE_URL_READONLY: readOnlyUrl,
    ...extra,
  };
  const config: DbConfig = dbConfigFromEnv(env, { readOnly: true });
  expect(config).toMatchObject({ kind: 'pg', url: readOnlyUrl });
  return { env, config };
}

describe('read-only credential attestation on Postgres', () => {
  it('baseline gap: the static configuration check accepts the owner login, which can write', async () => {
    productionConfig(urls.owner);
    const client = new pg.Client({ connectionString: urls.owner });
    await client.connect();
    try {
      await client.query('begin read write');
      await client.query('update person set full_name = full_name where false');
      await client.query('rollback');
    } finally {
      await client.end();
    }
  });

  it('refuses the schema-owner login placed in DATABASE_URL_READONLY', async () => {
    const { attestReadOnlyCredentials, createReadOnlyGate, ReadOnlyCredentialsError } =
      await attestation();
    const { env, config } = productionConfig(urls.owner);
    const result = await attestReadOnlyCredentials(config, env);
    expect(result.action).toBe('refuse');
    if (result.action !== 'refuse') return;
    expect(result.problems).toEqual(
      expect.arrayContaining(['owns_relations', 'writable_relations']),
    );
    expect(result.warnings).toContain('default_transaction_read_only_off');
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(LOGINS.owner);
    // The gate a production consumer runs before its first read fails closed, permanently.
    const gate = createReadOnlyGate(
      () => attestReadOnlyCredentials(config, env),
      () => {},
    );
    await expect(gate()).rejects.toBeInstanceOf(ReadOnlyCredentialsError);
  });

  it('refuses a superuser URL and an ingest (DML) login', async () => {
    const { attestReadOnlyCredentials } = await attestation();
    const superuser = productionConfig(urls.superuser);
    const su = await attestReadOnlyCredentials(superuser.config, superuser.env);
    expect(su.action).toBe('refuse');
    if (su.action === 'refuse') expect(su.problems).toContain('superuser');

    const loader = productionConfig(urls.loader);
    const dml = await attestReadOnlyCredentials(loader.config, loader.env);
    expect(dml.action).toBe('refuse');
    if (dml.action === 'refuse') {
      expect(dml.problems).toEqual(['writable_relations', 'writable_sequences']);
      // default_transaction_read_only is set, but `begin read write` defeats it: privileges decide.
      expect(dml.warnings).toEqual([]);
    }
  });

  it('accepts a civic_readonly member login set up as OPERATIONS.md describes', async () => {
    const { attestReadOnlyCredentials, createReadOnlyGate } = await attestation();
    const { env, config } = productionConfig(urls.reader);
    const result = await attestReadOnlyCredentials(config, env);
    expect(result).toMatchObject({ action: 'accept', problems: [], warnings: [] });
    const gate = createReadOnlyGate(
      () => attestReadOnlyCredentials(config, env),
      () => {},
    );
    await expect(gate()).resolves.toBeUndefined();
  });

  it('only warns for a civic_readonly login without default_transaction_read_only', async () => {
    const { attestReadOnlyCredentials } = await attestation();
    const { env, config } = productionConfig(urls.readerNoDefault);
    const result = await attestReadOnlyCredentials(config, env);
    expect(result).toMatchObject({
      action: 'warn',
      problems: [],
      warnings: ['default_transaction_read_only_off'],
    });
  });

  it('acknowledged owner credentials run, but the warning names what the login can do', async () => {
    const { attestReadOnlyCredentials } = await attestation();
    const { env, config } = productionConfig(urls.owner, { DB_ALLOW_OWNER_CREDENTIALS: '1' });
    const result = await attestReadOnlyCredentials(config, env);
    expect(result.action).toBe('warn');
    if (result.action === 'warn') expect(result.problems).toContain('owns_relations');
  });
});
