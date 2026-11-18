import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@civic-ledger/db';
import { MIGRATIONS_FOLDER, runMigrations } from '@civic-ledger/db/migrate';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describe, expect, it } from 'vitest';
import { createTestDatabase, migratedDatabase, rows, type TestDatabase } from './helpers';

/**
 * `0009_evidence_checks_provisional` was the evidence-trust branch's own `0006` (same DDL,
 * journal `when` 1792388567954). A database migrated on that branch has its objects; main's
 * migrator then runs 0006-0009 there (drizzle compares only `created_at`), so 0009 must apply
 * over existing objects and leave exactly the schema a clean migration produces.
 */
const here = dirname(fileURLToPath(import.meta.url));
const BRANCH_0006 = join(here, 'fixtures', 'branch-0006_evidence_checks_provisional.sql');
const BRANCH_TAG = '0006_evidence_checks_provisional';
const BRANCH_WHEN = 1792388567954;

interface Journal {
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
}

async function mainJournal(): Promise<Journal> {
  return JSON.parse(await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
}

/** A migrations folder whose journal is `entries`, with the branch 0006 file added. */
async function folderWith(entries: Journal['entries']): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'civic-migrations-'));
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  await cp(BRANCH_0006, join(folder, `${BRANCH_TAG}.sql`));
  const journal = await mainJournal();
  await writeFile(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return folder;
}

async function openAt(folder: string): Promise<{ db: TestDatabase; handle: DbHandle }> {
  const db = await createTestDatabase();
  const handle = createDb({ kind: 'pg', url: db.url, poolMax: 4 });
  if (handle.kind !== 'pg') throw new Error('expected a pg handle');
  await migrate(handle.db, { migrationsFolder: folder });
  return { db, handle };
}

/** Every public column, constraint, index, sequence and view definition, sorted. */
async function schemaFingerprint(handle: DbHandle): Promise<string[]> {
  const result = await rows<{ v: string }>(
    handle,
    sql`select v from (
      select 'column ' || table_name || '.' || column_name || ' #' || ordinal_position || ' ' ||
        data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '') ||
        ' identity=' || coalesce(identity_generation, '') as v
        from information_schema.columns where table_schema = 'public'
      union all select 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' ||
        pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
      union all select 'index ' || indexdef from pg_indexes where schemaname = 'public'
      union all select 'sequence ' || sequencename || ' ' || data_type || ' ' || start_value ||
        ' ' || min_value || ' ' || max_value || ' ' || increment_by || ' ' || cache_size
        from pg_sequences where schemaname = 'public'
      union all select 'view ' || viewname || ' ' || definition from pg_views where schemaname = 'public'
      union all select 'matview ' || matviewname || ' ' || definition from pg_matviews
        where schemaname = 'public'
    ) f order by v`,
  );
  return result.map((r) => r.v);
}

describe('0009 over a database migrated with the evidence-trust branch 0006', () => {
  it('upgrades a branch database without 42P07, keeps its rows and ends at the clean schema', async () => {
    const journal = await mainJournal();
    const upTo0005 = journal.entries.slice(0, 6);
    expect(upTo0005.at(-1)?.tag).toBe('0005_ingest_receipts_and_coverage');
    expect(journal.entries.at(-1)?.tag).toBe('0009_evidence_checks_provisional');
    const branchFolder = await folderWith([
      ...upTo0005,
      { idx: 6, version: '7', when: BRANCH_WHEN, tag: BRANCH_TAG, breakpoints: true },
    ]);
    const branch = await openAt(branchFolder);
    const clean = await migratedDatabase();
    try {
      // A recheck recorded on the branch database must survive the upgrade.
      await branch.handle.db.execute(sql`insert into source (id, name, url, license, description)
        values ('test', 'Test data', 'https://example.org', 'test', 'fictional')`);
      await branch.handle.db.execute(sql`insert into ingest_run (source_id, adapter_version, scope, status, snapshot_locator)
        values ('test', 'test@1', 'all', 'succeeded', 'test/2026-10-19/1-abcdef012345')`);
      await branch.handle.db.execute(sql`insert into ingest_check (source_id, scope, adapter_version, snapshot_checksum, publication_run_id, started_at)
        select 'test', 'all', 'test@1', 'abc', id, now() from ingest_run`);

      // Main's migrator: 0006_district_map .. 0009 are all newer than the branch 0006.
      await runMigrations(branch.handle);

      const applied = await rows<{ n: number }>(
        branch.handle,
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      expect(applied[0]?.n).toBe(journal.entries.length + 1); // 0000-0005, branch 0006, 0006-0009
      const kept = await rows<{ locator: string; checks: number }>(
        branch.handle,
        sql`select r.snapshot_locator as locator, count(c.id)::int as checks
          from ingest_run r left join ingest_check c on c.publication_run_id = r.id group by r.id`,
      );
      expect(kept).toEqual([{ locator: 'test/2026-10-19/1-abcdef012345', checks: 1 }]);
      expect(await schemaFingerprint(branch.handle)).toEqual(await schemaFingerprint(clean.handle));
      // A second run is a no-op.
      await runMigrations(branch.handle);
    } finally {
      await branch.handle.close();
      await branch.db.drop();
      await clean.cleanup();
    }
  });

  it('on a database at 0008, the guarded 0009 creates exactly what the unguarded DDL did', async () => {
    const journal = await mainJournal();
    const upTo0008 = journal.entries.slice(0, -1);
    expect(upTo0008.at(-1)?.tag).toBe('0008_candidate');
    const previous = await openAt(await folderWith(upTo0008));
    const clean = await migratedDatabase();
    try {
      // The original, unguarded statements (the branch file is byte-identical DDL).
      const original = await readFile(BRANCH_0006, 'utf8');
      for (const statement of original.split('--> statement-breakpoint')) {
        await previous.handle.db.execute(sql.raw(statement));
      }
      expect(await schemaFingerprint(previous.handle)).toEqual(
        await schemaFingerprint(clean.handle),
      );
    } finally {
      await previous.handle.close();
      await previous.db.drop();
      await clean.cleanup();
    }
  });

  // Guards trust names; 0009 then verifies definitions and fails loudly on a mismatch.
  it.each([
    {
      what: 'a same-name index on the wrong column',
      drift: `drop index ingest_check_source_scope_idx;
        create index ingest_check_source_scope_idx on ingest_check (publication_run_id)`,
      message: /ingest_check_source_scope_idx is CREATE INDEX .*\(publication_run_id\)/,
    },
    {
      what: 'a same-name foreign key with another definition',
      drift: `alter table ingest_check drop constraint ingest_check_source_id_source_id_fk;
        alter table ingest_check add constraint ingest_check_source_id_source_id_fk
          foreign key (publication_run_id) references ingest_run (id)`,
      message: /ingest_check_source_id_source_id_fk is not FOREIGN KEY \(source_id\)/,
    },
    {
      what: 'a same-name table with another definition',
      drift: 'alter table ingest_check add column extra text',
      message: /ingest_check columns are .*extra text/,
    },
  ])('refuses $what and leaves the database unchanged', async ({ drift, message }) => {
    const journal = await mainJournal();
    const branch = await openAt(
      await folderWith([
        ...journal.entries.slice(0, 6),
        { idx: 6, version: '7', when: BRANCH_WHEN, tag: BRANCH_TAG, breakpoints: true },
      ]),
    );
    try {
      for (const statement of drift.split(';')) await branch.handle.db.execute(sql.raw(statement));
      const applied = async () =>
        (
          await rows<{ n: number }>(
            branch.handle,
            sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
          )
        )[0]?.n;
      const before = await applied();
      const error = await runMigrations(branch.handle).then(
        () => null,
        (e: unknown) => e,
      );
      const text = String((error as { cause?: unknown })?.cause ?? error);
      expect(text).toMatch(/0009_evidence_checks_provisional: existing objects differ/);
      expect(text).toMatch(message);
      // The whole pending batch (0006-0009) rolled back: nothing applied, no district_map.
      expect(await applied()).toBe(before);
      const tables = await rows<{ n: number }>(
        branch.handle,
        sql`select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = 'district_map'`,
      );
      expect(tables[0]?.n).toBe(0);
    } finally {
      await branch.handle.close();
      await branch.db.drop();
    }
  });
});
