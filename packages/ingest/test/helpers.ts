import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IngestScope, SourceId } from '@civic-ledger/core';
import { createDb, type Db, type DbHandle } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { sql } from 'drizzle-orm';
import { ADAPTERS } from '../src/adapters/registry';
import { silentLogger } from '../src/runtime/logger';
import { type IngestRuntime, runIngest } from '../src/runtime/run';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const SCOPES: Record<keyof typeof ADAPTERS, IngestScope> = {
  'congress-legislators': { kind: 'all' },
  voteview: { kind: 'congress', congress: 119 },
  'fec-bulk': { kind: 'cycle', cycle: 2026 },
  'govinfo-billstatus': { kind: 'congress', congress: 119 },
  curated: { kind: 'all' },
};

export async function freshDb(): Promise<DbHandle> {
  const handle = createDb({ kind: 'pglite' });
  await runMigrations(handle);
  return handle;
}

export async function testRuntime(
  handle: DbHandle,
  overrides: Partial<IngestRuntime> = {},
): Promise<IngestRuntime> {
  return {
    handle,
    adapters: ADAPTERS,
    logger: silentLogger,
    rawRoot: await mkdtemp(join(tmpdir(), 'civic-raw-')),
    repoRoot: REPO_ROOT,
    ...overrides,
  };
}

/** Runs one source from its committed fixture directory (or `snapshotPath`). */
export function ingestFixture(
  rt: IngestRuntime,
  source: keyof typeof ADAPTERS,
  snapshotPath: string = join(FIXTURES, source),
) {
  return runIngest({ source: source as SourceId, scope: SCOPES[source], snapshotPath }, rt);
}

/**
 * Curated snapshot for tests: the repository's real policy areas and industry map plus
 * fictional promise/platform/framework files about a fictional person (X000001), so tests
 * never assert claims about a real politician.
 */
export async function curatedFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-curated-'));
  for (const kind of ['policy_areas', 'industry_map']) {
    await cp(join(REPO_ROOT, 'data', 'curated', kind), join(dir, kind), {
      recursive: true,
      filter: (src) => !src.endsWith('README.md'),
    });
  }
  await cp(join(FIXTURES, 'curated'), dir, { recursive: true });
  return dir;
}

export async function writeYaml(dir: string, path: string, content: string): Promise<void> {
  await writeFile(join(dir, path), content);
}

/** A fictional person (bioguide X000001) for curated tests, with its own provenance. */
export async function insertFictionalPerson(db: Db): Promise<number> {
  await db.execute(sql`insert into source (id, name, url, license, description)
    values ('test', 'Test data', 'https://example.org', 'test', 'fictional') on conflict do nothing`);
  const run =
    (await db.execute(sql`insert into ingest_run (source_id, adapter_version, scope, status)
    values ('test', 'test@1', 'all', 'succeeded') returning id`)) as unknown as {
      rows: { id: number }[];
    };
  const runId = run.rows[0]?.id;
  const person =
    (await db.execute(sql`insert into person (slug, full_name, first_name, last_name, source_id, source_key, ingest_run_id, retrieved_at)
    values ('avery-ashvale-x000001', 'Avery Ashvale', 'Avery', 'Ashvale', 'test', 'X000001', ${runId}, now()) returning id`)) as unknown as {
      rows: { id: number }[];
    };
  const personId = person.rows[0]?.id;
  if (personId === undefined) throw new Error('fictional person not created');
  await db.execute(sql`insert into person_identifier (person_id, scheme, value, source_id, source_key, ingest_run_id, retrieved_at)
    values (${personId}, 'bioguide', 'X000001', 'test', 'X000001', ${runId}, now())`);
  return personId;
}

export async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

export const FACT_TABLES = [
  'person',
  'person_identifier',
  'office',
  'term',
  'candidacy',
  'committee',
  'committee_link',
  'candidate_cycle_totals',
  'committee_contribution',
  'independent_expenditure',
  'industry',
  'committee_industry',
  'policy_area',
  'bill',
  'bill_policy_area',
  'bill_subject',
  'rollcall',
  'rollcall_bill',
  'vote_position',
  'ideology_score',
  'promise',
  'promise_rating',
  'platform_position',
  'framework',
  'framework_rule',
  'ingest_run',
] as const;

export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of FACT_TABLES) {
    const [row] = await rows<{ n: number }>(
      db,
      sql.raw(`select count(*)::int as n from "${table}"`),
    );
    out[table] = row?.n ?? 0;
  }
  return out;
}
