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
    expect(receipt.error).toMatch(/^shrink guard: .*candidate/s);
    expect(await names()).toEqual(before);
  });
});
