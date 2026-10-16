import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../src';
import { runMigrations } from '../src/migrate';
import { DEV_SEED_SOURCE_ID, seedDevData } from '../src/seed';
import { buildSeedData } from '../src/seed/fixtures';

const TABLES = [
  'person',
  'person_identifier',
  'office',
  'term',
  'candidacy',
  'committee',
  'committee_link',
  'committee_industry',
  'candidate_cycle_totals',
  'candidate_cycle_summary',
  'committee_contribution',
  'independent_expenditure',
  'industry',
  'policy_area',
  'bill',
  'bill_policy_area',
  'bill_subject',
  'rollcall',
  'rollcall_bill',
  'vote_position',
  'ideology_score',
  'scorecard_publisher',
  'scorecard_score',
  'promise',
  'promise_rating',
  'platform_position',
  'framework',
  'framework_rule',
  'ingest_run',
  'person_card',
  'person_card_scorecard',
];

async function rowCounts(handle: DbHandle): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const result = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    );
    counts[table] = result.rows[0]?.n ?? -1;
  }
  return counts;
}

describe('dev seed', () => {
  let handle: DbHandle;
  let first: Record<string, number>;

  beforeAll(async () => {
    handle = createDb({ kind: 'pglite' });
    await runMigrations(handle);
    await seedDevData(handle.db);
    first = await rowCounts(handle);
  });
  afterAll(() => handle.close());

  it('loads every table', () => {
    for (const table of TABLES) expect(first[table], table).toBeGreaterThan(0);
    expect(first.person).toBe(43);
  });

  it('is idempotent: a second load changes no row counts and reuses the run', async () => {
    const second = await seedDevData(handle.db);
    expect(await rowCounts(handle)).toEqual(first);
    expect(second.ingestRunId).toBe(1);
  });

  it('is deterministic', () => {
    expect(buildSeedData()).toEqual(buildSeedData());
  });

  it('is clearly fictional: fictional states, dev-seed provenance, example.org links', async () => {
    const data = buildSeedData();
    expect(new Set(data.people.map((p) => p.state))).toEqual(
      new Set(['ZV', 'ZW', 'ZX', 'ZY', 'ZZ']),
    );
    const nonSeed = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from person where source_id <> ${DEV_SEED_SOURCE_ID}`,
    );
    expect(nonSeed.rows[0]?.n).toBe(0);
    const urls = await handle.db.execute<{ url: string }>(
      sql`select url from bill union select source_url from promise union select methodology_url from scorecard_score`,
    );
    for (const { url } of urls.rows)
      expect(url.startsWith('https://example.org/dev-seed')).toBe(true);
  });

  it('spans both chambers, three parties and leaves some PAC money uncoded', async () => {
    const shape = await handle.db.execute<{
      chambers: number;
      parties: number;
      min_coverage: number;
    }>(sql`
      select count(distinct chamber)::int as chambers, count(distinct party)::int as parties,
             min(industry_coding_coverage) as min_coverage
      from person_card`);
    expect(shape.rows[0]).toMatchObject({ chambers: 2, parties: 3 });
    expect(shape.rows[0]?.min_coverage).toBeLessThan(1);
  });
});
