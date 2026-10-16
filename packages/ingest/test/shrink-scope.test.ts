import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHRINK_GUARD } from '../src/runtime/shrink-guard';
import { FIXTURES, freshDb, ingestFixture, rows, testRuntime } from './helpers';
import { writeZip } from './support/zip';

/**
 * H3-02: the shrink guard must judge each dataset (table and scope) on its own loaded-row
 * counter, so diagnostics, other tables and other cycles cannot hide one dataset's
 * collapse. P3/P4 are the H3 review's probes, reproduced through the real runtime.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

async function copyFixture(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-shrink-scope-'));
  await cp(join(FIXTURES, source), dir, { recursive: true });
  return dir;
}

const count = async (table: string, where = 'true') => {
  const [row] = await rows<{ n: number }>(
    handle.db,
    sql.raw(`select count(*)::int as n from ${table} where ${where}`),
  );
  return row?.n ?? 0;
};

/** A previous `cycle:2024` fec-bulk load: `n` totals rows owned by the source. */
async function insertOtherCycle(n: number): Promise<void> {
  const [run] = await rows<{ id: number }>(
    handle.db,
    sql`insert into ingest_run (source_id, adapter_version, scope, status, counts)
      values ('fec-bulk', 'fec-bulk@2', 'cycle:2024', 'succeeded', ${JSON.stringify({ totals: n })}::jsonb)
      returning id`,
  );
  await handle.db.execute(sql`
    insert into candidate_cycle_totals (fec_candidate_id, cycle, total_receipts_cents, individual_cents,
      other_committee_cents, party_cents, candidate_self_cents, total_disbursements_cents,
      cash_on_hand_cents, debts_cents, source_id, source_key, ingest_run_id, retrieved_at)
    select 'H4XX' || lpad(g::text, 5, '0'), 2024, 100, 0, 0, 0, 0, 0, 0, 0,
      'fec-bulk', 'weball:synthetic:' || g, ${run?.id}, now()
    from generate_series(1, ${n}) g`);
}

describe('shrink guard per dataset and scope (H3-02)', () => {
  it('P3: refuses a votes load whose positions collapse into unmatched-member diagnostics', async () => {
    const guard = { ...DEFAULT_SHRINK_GUARD, minBaseline: 10 };
    const rt = await testRuntime(handle, { shrinkGuard: guard });
    await ingestFixture(rt, 'congress-legislators');
    const good = await ingestFixture(rt, 'voteview');
    expect(good.counts.vote_positions).toBe(18);

    const unmatched = await copyFixture('voteview');
    const path = join(unmatched, 'HS119_votes.csv');
    const [header, ...lines] = (await readFile(path, 'utf8')).trimEnd().split('\n');
    const rewritten = lines.map((line) => {
      const cells = line.split(',');
      cells[3] = '99999';
      return cells.join(',');
    });
    await writeFile(path, `${[header, ...rewritten].join('\n')}\n`);
    const receipt = await ingestFixture(rt, 'voteview', unmatched);

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard: .*vote_positions/s);
  });

  it('P4: refuses a cycle whose totals file collapses while another cycle dilutes the source', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const good = await ingestFixture(rt, 'fec-bulk');
    expect(good.status).toBe('succeeded');
    await insertOtherCycle(400);
    const totals2026 = await count('candidate_cycle_totals', 'cycle = 2026');
    expect(totals2026).toBe(19);

    const collapsed = await copyFixture('fec-bulk');
    await writeZip(join(collapsed, 'weball26.zip'), 'weball26.txt', '');
    const receipt = await ingestFixture(
      await testRuntime(handle, {
        adapters: {
          ...rt.adapters,
          'fec-bulk': { ...rt.adapters['fec-bulk'], version: 'fec-bulk@shrink-scope' },
        } as typeof rt.adapters,
      }),
      'fec-bulk',
      collapsed,
    );

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard: .*candidate_cycle_totals/s);
    expect(await count('candidate_cycle_totals', 'cycle = 2026')).toBe(totals2026);
  });

  it('one-file collapse: refuses an emptied independent-expenditure file within one cycle', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const good = await ingestFixture(rt, 'fec-bulk');
    expect(good.counts.independent_expenditures).toBe(8);

    const collapsed = await copyFixture('fec-bulk');
    const iePath = join(collapsed, 'independent_expenditure_2026.csv');
    const [header] = (await readFile(iePath, 'utf8')).split('\n');
    await writeFile(iePath, `${header}\n`);
    const receipt = await ingestFixture(rt, 'fec-bulk', collapsed);

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard: .*independent_expenditure/s);
    expect(await count('independent_expenditure')).toBe(8);
  });

  it('--allow-shrink commits the load and records the overridden violation on the receipt', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    await ingestFixture(rt, 'fec-bulk');
    const collapsed = await copyFixture('fec-bulk');
    const iePath = join(collapsed, 'independent_expenditure_2026.csv');
    const [header] = (await readFile(iePath, 'utf8')).split('\n');
    await writeFile(iePath, `${header}\n`);
    const override = await testRuntime(handle, {
      shrinkGuard: { ...DEFAULT_SHRINK_GUARD, allow: true },
    });
    const receipt = await ingestFixture(override, 'fec-bulk', collapsed);

    expect(receipt.status).toBe('succeeded');
    expect(receipt).toMatchObject({
      note: expect.stringMatching(/^shrink guard overridden \(--allow-shrink\): .*independent_expenditure/s),
    });
    expect(await count('independent_expenditure')).toBe(0);
  });
});
