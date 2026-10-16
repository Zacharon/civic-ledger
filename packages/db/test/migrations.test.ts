import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle, refreshPersonCard } from '../src';
import { runMigrations } from '../src/migrate';

describe('migrations on a fresh database', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb({ kind: 'pglite' });
    await runMigrations(handle);
  });
  afterAll(() => handle.close());

  it('creates every table and both read-model views', async () => {
    const tables = await handle.db.execute<{ name: string }>(
      sql`select table_name as name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(tables.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'person',
        'term',
        'committee_contribution',
        'vote_position',
        'framework_rule',
        'ingest_run',
      ]),
    );
    const views = await handle.db.execute<{ name: string }>(
      sql`select matviewname as name from pg_matviews order by 1`,
    );
    expect(views.rows.map((r) => r.name)).toEqual(['person_card', 'person_card_scorecard']);
  });

  it('is a no-op when applied again', async () => {
    await expect(runMigrations(handle)).resolves.toBeUndefined();
  });

  it('refreshes empty read models concurrently', async () => {
    await refreshPersonCard(handle.db);
    const count = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from person_card`,
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it('indexes every foreign key by its leading column', async () => {
    const unindexed = await handle.db.execute<{ fk: string }>(sql`
      select c.conrelid::regclass || '.' || a.attname as fk
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
        )
      order by 1`);
    expect(unindexed.rows).toEqual([]);
  });

  it('carries provenance columns on every fact table', async () => {
    const vocabulary = ['source', 'ingest_run', 'office', 'policy_area'];
    const missing = await handle.db.execute<{ table: string }>(sql`
      select t.table_name as table
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and t.table_name not like '\_\_%'
        and t.table_name not in (${sql.join(
          vocabulary.map((v) => sql`${v}`),
          sql`, `,
        )})
        and (
          select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name
            and c.column_name in ('source_id', 'source_key', 'ingest_run_id', 'retrieved_at')
        ) < 4
      order by 1`);
    expect(missing.rows).toEqual([]);
  });
});
