import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, refreshPersonCard } from '@civic-ledger/db';
import { MIGRATIONS_FOLDER, runMigrations } from '@civic-ledger/db/migrate';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describe, expect, it } from 'vitest';
import { createTestDatabase, migratedDatabase, rows } from './helpers';

describe('migrations on real Postgres', () => {
  it('applies every migration to a fresh database and re-applying is a no-op', async () => {
    const { handle, cleanup } = await migratedDatabase();
    try {
      const count = () =>
        rows<{ n: number }>(
          handle,
          sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
        );
      const before = await count();
      await runMigrations(handle);
      expect((await count())[0]?.n).toBe(before[0]?.n);
      const views = await rows<{ name: string }>(
        handle,
        sql`select matviewname as name from pg_matviews where schemaname = 'public'`,
      );
      expect(views.map((v) => v.name)).toEqual(
        expect.arrayContaining(['person_card', 'person_card_scorecard']),
      );
    } finally {
      await cleanup();
    }
  });

  it('applies the latest migration over a seeded database at the previous version', async () => {
    const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThan(1);

    // A copy of the migrations folder whose journal stops one entry short.
    const previous = await mkdtemp(join(tmpdir(), 'civic-migrations-'));
    await cp(MIGRATIONS_FOLDER, previous, { recursive: true });
    await writeFile(
      join(previous, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }),
    );

    const database = await createTestDatabase();
    const handle = createDb({ kind: 'pg', url: database.url, poolMax: 4 });
    try {
      if (handle.kind !== 'pg') throw new Error('expected a pg handle');
      await migrate(handle.db, { migrationsFolder: previous });
      // Raw SQL on the oldest, stable tables: the seed always targets the latest schema.
      await handle.db.execute(sql`insert into source (id, name, url, license, description)
        values ('test', 'Test data', 'https://example.org', 'test', 'fictional')`);
      await handle.db.execute(sql`insert into ingest_run (source_id, adapter_version, scope, status)
        values ('test', 'test@1', 'all', 'succeeded')`);
      await handle.db.execute(sql`insert into person (slug, full_name, first_name, last_name, source_id, source_key, ingest_run_id, retrieved_at)
        select 'avery-ashvale-x000001', 'Avery Ashvale', 'Avery', 'Ashvale', 'test', 'X000001', id, now() from ingest_run`);

      await runMigrations(handle);

      const people = await rows<{ slug: string }>(handle, sql`select slug from person`);
      expect(people.map((p) => p.slug)).toEqual(['avery-ashvale-x000001']);
      await refreshPersonCard(handle.db);
      const cards = await rows<{ n: number }>(
        handle,
        sql`select count(*)::int as n from person_card where slug = 'avery-ashvale-x000001'`,
      );
      expect(cards[0]?.n).toBe(1);
      const applied = await rows<{ n: number }>(
        handle,
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      expect(applied[0]?.n).toBe(journal.entries.length);
    } finally {
      await handle.close();
      await database.drop();
    }
  });
});
