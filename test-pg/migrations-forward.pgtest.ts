import { readFileSync } from 'node:fs';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchByName } from '@civic-ledger/core';
import { createDb, type DbHandle, refreshPersonCard } from '@civic-ledger/db';
import { MIGRATIONS_FOLDER, runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  type MigratedDatabase,
  migratedDatabase,
  type TestDatabase,
} from './helpers';

/**
 * VC-081 / VC-055: for every earlier schema version in the journal (not a fixed list), a
 * realistic dataset loaded at that version and upgraded through every later migration
 * keeps its rows and answers every public capability exactly like the same data loaded
 * straight into the latest schema. Also checks the upgrade only adds: every column a
 * previous app could read at that version still exists with the same type.
 *
 * Dataset: the fictional dev seed (40 people, 160 terms, committees, contributions, totals,
 * outside spending, bills, roll calls, 480 vote positions, scorecard scores, promises,
 * frameworks) plus refunds (negative contributions) added below.
 */

interface Journal {
  entries: Array<{ tag: string }>;
}

// Read at collection time, so every migration on disk (including new ones) becomes a case.
const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as Journal;
let source: MigratedDatabase;
const closers: Array<() => Promise<void>> = [];

async function client(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

beforeAll(async () => {
  source = await migratedDatabase();
  await seedDevData(source.handle.db);
  const c = await client(source.database.url);
  try {
    // Refunds: a negative receipt beside every seventh contribution, and one person whose
    // contributions are refunded in full.
    await c.query(`insert into committee_contribution (fec_sub_id, committee_id,
        recipient_fec_candidate_id, person_id, cycle, amount_cents, transaction_date,
        transaction_type, source_id, source_key, ingest_run_id, retrieved_at)
      select fec_sub_id || 'R', committee_id, recipient_fec_candidate_id, person_id, cycle,
        case when person_id = (select min(person_id) from committee_contribution)
          then -amount_cents else -(amount_cents / 2) end,
        transaction_date, '22Z', source_id, source_key || ':refund', ingest_run_id, retrieved_at
      from committee_contribution
      where id % 7 = 0 or person_id = (select min(person_id) from committee_contribution)`);
    const refunds = await c.query(
      'select count(*)::int as n from committee_contribution where amount_cents < 0',
    );
    expect(refunds.rows[0].n).toBeGreaterThan(5);
  } finally {
    await c.end();
  }
});

afterAll(async () => {
  for (const close of closers.reverse()) await close().catch(() => undefined);
  await source?.cleanup();
});

/** A database migrated to the first `count` journal entries. */
async function databaseAtVersion(count: number): Promise<{ db: TestDatabase; handle: DbHandle }> {
  const folder = await mkdtemp(join(tmpdir(), 'civic-migrations-'));
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  await writeFile(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }),
  );
  const db = await createTestDatabase();
  const handle = createDb({ kind: 'pg', url: db.url, poolMax: 4 });
  closers.push(async () => {
    await handle.close();
    await db.drop();
  });
  if (handle.kind !== 'pg') throw new Error('expected pg');
  await migrate(handle.db, { migrationsFolder: folder });
  return { db, handle };
}

type Columns = Map<string, string[]>;

/** Base tables and their insertable columns, as they exist in `url`. */
async function tableColumns(url: string): Promise<Columns> {
  const c = await client(url);
  try {
    const result = await c.query<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name from information_schema.columns c
         join information_schema.tables t using (table_schema, table_name)
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.is_generated = 'NEVER'
        order by c.table_name, c.ordinal_position`,
    );
    const out: Columns = new Map();
    for (const row of result.rows) {
      out.set(row.table_name, [...(out.get(row.table_name) ?? []), row.column_name]);
    }
    return out;
  } finally {
    await c.end();
  }
}

/** Every readable relation.column with its type: what a previous app's queries can touch. */
async function readableColumns(url: string): Promise<Map<string, string>> {
  const c = await client(url);
  try {
    const result = await c.query<{ key: string; type: string }>(
      `select cl.relname || '.' || a.attname as key, format_type(a.atttypid, a.atttypmod) as type
         from pg_attribute a join pg_class cl on cl.oid = a.attrelid
         join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and cl.relkind in ('r', 'v', 'm')
          and a.attnum > 0 and not a.attisdropped`,
    );
    return new Map(result.rows.map((r) => [r.key, r.type]));
  } finally {
    await c.end();
  }
}

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Copies `columns` of every table from the seeded source into `url`, ids included. */
async function copyData(url: string, columns: Columns): Promise<Map<string, number>> {
  const from = await client(source.database.url);
  const to = await client(url);
  const counts = new Map<string, number>();
  try {
    // Superuser test connection: skip FK ordering while copying, then restore.
    await to.query('set session_replication_role = replica');
    for (const [table, cols] of columns) {
      const list = cols.map(q).join(', ');
      const data = await from.query<{ rows: unknown[] }>(
        `select coalesce(json_agg(t), '[]'::json) as rows from (select ${list} from ${q(table)}) t`,
      );
      const rows = data.rows[0]?.rows ?? [];
      counts.set(table, rows.length);
      if (rows.length === 0) continue;
      await to.query(
        `insert into ${q(table)} (${list}) overriding system value
           select ${list} from json_populate_recordset(null::${q(table)}, $1::json)`,
        [JSON.stringify(rows)],
      );
      const seq = cols.includes('id')
        ? (
            await to.query<{ seq: string | null }>(
              "select pg_get_serial_sequence($1, 'id') as seq",
              [table],
            )
          ).rows[0]?.seq
        : null;
      if (seq) {
        await to.query(`select setval($1, (select coalesce(max(id), 1) from ${q(table)}))`, [seq]);
      }
    }
    await to.query('set session_replication_role = origin');
  } finally {
    await from.end();
    await to.end();
  }
  return counts;
}

async function counts(url: string, tables: Iterable<string>): Promise<Map<string, number>> {
  const c = await client(url);
  try {
    const out = new Map<string, number>();
    for (const table of tables) {
      const r = await c.query(`select count(*)::int as n from ${q(table)}`);
      out.set(table, r.rows[0].n);
    }
    return out;
  } finally {
    await c.end();
  }
}

/** Times written by a refresh differ between two databases by construction. */
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /refreshed/i.test(k) ? '<refresh time>' : normalized(v),
      ]),
    );
  }
  return value;
}

async function personCard(url: string): Promise<unknown[]> {
  const c = await client(url);
  try {
    const r = await c.query('select * from person_card order by slug');
    return r.rows.map(normalized);
  } finally {
    await c.end();
  }
}

/** Every public capability with inputs that touch money, votes, scores and frameworks. */
async function answers(handle: DbHandle): Promise<Record<string, unknown>> {
  const ctx = { db: handle.db };
  const call = (name: string, input: unknown) => dispatchByName(name, input, ctx);
  const people = (await call('people.search', { limit: 100, scope: 'all' })) as {
    items: Array<{ slug: string }>;
  };
  const slugs = people.items.map((p) => p.slug).slice(0, 12);
  const frameworks = (await call('frameworks.list', {})) as { items: Array<{ spec: unknown }> };
  const out: Record<string, unknown> = {
    'people.search': people,
    'explore.table': await call('explore.table', { filters: { scope: 'all' }, limit: 100 }),
    'explore.facets': await call('explore.facets', { scope: 'all' }),
    'people.compare': await call('people.compare', { slugs: slugs.slice(0, 3) }),
    'votes.list': await call('votes.list', { limit: 100 }),
    'policy.areas': await call('policy.areas', {}),
    'frameworks.list': frameworks,
    'frameworks.evaluate': await Promise.all(
      frameworks.items.map((f) => call('frameworks.evaluate', { framework: f.spec, limit: 100 })),
    ),
    'sources.status': await call('sources.status', {}),
    'explainers.list': await call('explainers.list', {}),
  };
  for (const slug of slugs) {
    out[`people.get ${slug}`] = await call('people.get', { slug });
    out[`people.glance ${slug}`] = await call('people.glance', { slug });
    out[`money.summary ${slug}`] = await call('money.summary', { slug });
    out[`scores.list ${slug}`] = await call('scores.list', { slug });
    out[`promises.list ${slug}`] = await call('promises.list', { slug });
  }
  return normalized(out) as Record<string, unknown>;
}

describe('forward migrations over a realistic dataset at every earlier version', () => {
  it('the journal has earlier versions to test', () => {
    expect(journal.entries.length).toBeGreaterThan(1);
  });

  const versions = journal.entries
    .slice(0, -1)
    .map((entry, i) => ({ count: i + 1, tag: entry.tag }));

  it.each(versions)(
    'upgrading from $tag preserves rows, cards and every capability answer',
    async ({ count }) => {
      const old = await databaseAtVersion(count);
      const oldColumns = await tableColumns(old.db.url);
      const loaded = await copyData(old.db.url, oldColumns);
      const readableBefore = await readableColumns(old.db.url);

      await runMigrations(old.handle);
      await refreshPersonCard(old.handle.db);

      // The same data (same columns: nothing the old schema could not hold) loaded at latest.
      const reference = await migratedDatabase();
      closers.push(() => reference.cleanup());
      await copyData(reference.database.url, oldColumns);
      await refreshPersonCard(reference.handle.db);

      expect(await counts(old.db.url, loaded.keys())).toEqual(loaded);
      expect(loaded.get('person')).toBeGreaterThan(30);
      expect(loaded.get('vote_position')).toBeGreaterThan(100);
      expect(await personCard(old.db.url)).toEqual(await personCard(reference.database.url));
      const upgraded = await answers(old.handle);
      expect(upgraded).toEqual(await answers(reference.handle));
      // Not vacuous: the answers carry money and votes.
      const table = upgraded['explore.table'] as { rows: Array<{ totalReceiptsCents: unknown }> };
      expect(table.rows.filter((r) => r.totalReceiptsCents !== null).length).toBeGreaterThan(10);
      expect((upgraded['votes.list'] as { items: unknown[] }).items.length).toBeGreaterThan(10);

      // Expand-only: what the previous app could read still exists with the same type.
      const readableAfter = await readableColumns(old.db.url);
      const broken = [...readableBefore]
        .filter(([key, type]) => readableAfter.get(key) !== type)
        .map(([key, type]) => `${key} ${type} -> ${readableAfter.get(key) ?? 'missing'}`);
      expect(broken).toEqual([]);
    },
  );
});
