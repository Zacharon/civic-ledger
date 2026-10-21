import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES, freshDb, ingestFixture, rows, testRuntime } from './helpers';
import { writeZip } from './support/zip';

/**
 * The `candidate` table (DECISIONS A21 amendment): stale-row sweep and shrink-guard
 * declaration. Parse and load of the rows themselves are covered in pipeline.test.ts.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

async function fecFixtureWithCn(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-candidate-'));
  await cp(join(FIXTURES, 'fec-bulk'), dir, { recursive: true });
  await writeZip(join(dir, 'cn26.zip'), 'cn.txt', `${lines.join('\n')}\n`);
  return dir;
}

const cn = (id: string, name: string, office: 'H' | 'S', state: string, district: string) =>
  `${id}|${name}|DEM|2026|${state}|${office}|${district}|C|C|C00000001|||CITY|${state}|00000`;

const names = async () =>
  (
    await rows<{ id: string; name: string }>(
      handle.db,
      sql`select fec_candidate_id as id, name_as_filed as name from candidate order by 1`,
    )
  ).map((r) => `${r.id}:${r.name}`);

describe('candidate table reload', () => {
  it('updates changed rows in place and sweeps candidates the FEC no longer lists', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const first = await ingestFixture(rt, 'fec-bulk');
    expect(first.counts).toMatchObject({ candidate_rows: 16, stale_candidates_deleted: 0 });

    const next = await fecFixtureWithCn([
      cn('H4FL01197', 'VALIMONT, JENNIFER G', 'H', 'FL', '01'),
      cn('H9ZZ01001', 'NEWFILER, NORA', 'H', 'ZZ', '01'),
    ]);
    const second = await ingestFixture(rt, 'fec-bulk', next);
    expect(second.status).toBe('succeeded');
    expect(second.counts).toMatchObject({ candidate_rows: 2, stale_candidates_deleted: 15 });
    expect(await names()).toEqual(['H4FL01197:VALIMONT, JENNIFER G', 'H9ZZ01001:NEWFILER, NORA']);
  });

  it('refuses a load whose candidate master collapses to nothing', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    await ingestFixture(rt, 'fec-bulk');
    const before = await names();
    expect(before).toHaveLength(16);

    const emptied = await fecFixtureWithCn([]);
    const receipt = await ingestFixture(rt, 'fec-bulk', emptied);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard: .*rows in candidate for cycle:2026/s);
    expect(await names()).toEqual(before);
  });

  it('stores a blank House district as null, a "00" as 0 and an empty name as null', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const dir = await fecFixtureWithCn([
      cn('H6AZ08210', '', 'H', 'AZ', ''),
      cn('H6GA00001', 'ZERO, GEORGIA', 'H', 'GA', '00'),
      cn('H6GA00002', 'TWENTYTHREE, GEORGIA', 'H', 'GA', '23'),
      cn('S6GA00001', 'SENATE, GEORGIA', 'S', 'GA', '00'),
    ]);
    const receipt = await ingestFixture(rt, 'fec-bulk', dir);
    expect(receipt.status).toBe('succeeded');
    const stored = await rows<{ id: string; name: string | null; district: number | null }>(
      handle.db,
      sql`select fec_candidate_id as id, name_as_filed as name, district from candidate order by 1`,
    );
    expect(stored).toEqual([
      { id: 'H6AZ08210', name: null, district: null },
      { id: 'H6GA00001', name: 'ZERO, GEORGIA', district: 0 },
      { id: 'H6GA00002', name: 'TWENTYTHREE, GEORGIA', district: 23 },
      { id: 'S6GA00001', name: 'SENATE, GEORGIA', district: null },
    ]);
  });

  it('reloads an already-loaded snapshot when the adapter version changes (idempotency key)', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const first = await ingestFixture(rt, 'fec-bulk');
    expect(first.deduplicated).toBe(false);
    // Same version and snapshot: answered from the ledger, nothing reloaded.
    const again = await ingestFixture(rt, 'fec-bulk');
    expect(again.deduplicated).toBe(true);

    // The state before fec-bulk@3: the table did not exist, so it is empty after migration.
    await handle.db.execute(sql`delete from candidate`);
    expect(await names()).toHaveLength(0);
    const again2 = await ingestFixture(rt, 'fec-bulk');
    expect(again2.deduplicated).toBe(true);
    expect(await names()).toHaveLength(0);

    // A new adapter version is a new idempotency key: the same bytes load again.
    const bumped = await testRuntime(handle, {
      adapters: {
        ...rt.adapters,
        'fec-bulk': { ...rt.adapters['fec-bulk'], version: 'fec-bulk@next' },
      } as typeof rt.adapters,
    });
    const reloaded = await ingestFixture(bumped, 'fec-bulk');
    expect(reloaded.status).toBe('succeeded');
    expect(reloaded.deduplicated).toBe(false);
    expect(await names()).toHaveLength(16);
  });

  it('ships the adapter at a version that includes the candidate table', async () => {
    const { fecBulkAdapter } = await import('../src/adapters/fec-bulk');
    expect(fecBulkAdapter.version).toBe('fec-bulk@3');
  });
});
