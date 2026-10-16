import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHRINK_GUARD,
  evaluateShrink,
  recordTotal,
  shrinkGuardFromEnv,
} from '../src/runtime/shrink-guard';
import { FIXTURES, freshDb, ingestFixture, rows, tableCounts, testRuntime } from './helpers';

let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

async function copyFixture(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-shrink-'));
  await cp(join(FIXTURES, source), dir, { recursive: true });
  return dir;
}

describe('evaluateShrink', () => {
  const previous = { people: 100, terms: 50, stale_terms_deleted: 3 };

  it('ignores sweep counters when totalling loaded records', () => {
    expect(recordTotal(previous)).toBe(150);
  });

  it('accepts a normal refresh, a first load and small corrections', () => {
    const counts = { people: 100, terms: 48, stale_terms_deleted: 2 };
    expect(
      evaluateShrink({ existingRows: 150, counts, previous }, DEFAULT_SHRINK_GUARD),
    ).toBeNull();
    expect(
      evaluateShrink(
        { existingRows: 0, counts: { people: 3 }, previous: null },
        DEFAULT_SHRINK_GUARD,
      ),
    ).toBeNull();
  });

  it('refuses a sweep that deletes more than the allowed share of existing rows', () => {
    const counts = { people: 100, stale_rows_deleted: 40 };
    expect(
      evaluateShrink({ existingRows: 200, counts, previous: null }, DEFAULT_SHRINK_GUARD),
    ).toMatch(/would delete 40 of 200 existing rows \(20%, limit 10%\)/);
  });

  it('refuses a load far below the last successful run, but not a tiny baseline', () => {
    const counts = { people: 10, terms: 5 };
    expect(evaluateShrink({ existingRows: 0, counts, previous }, DEFAULT_SHRINK_GUARD)).toMatch(
      /loaded 15 records against 150 in the last successful run/,
    );
    expect(
      evaluateShrink(
        { existingRows: 0, counts: { people: 0 }, previous: { people: 5 } },
        DEFAULT_SHRINK_GUARD,
      ),
    ).toBeNull();
  });

  it('reads thresholds from the environment and rejects nonsense', () => {
    expect(
      shrinkGuardFromEnv(
        { INGEST_MAX_DELETE_FRACTION: '0.25', INGEST_MIN_RECORD_RATIO: '0.8' },
        true,
      ),
    ).toMatchObject({ allow: true, maxDeleteFraction: 0.25, minRecordRatio: 0.8 });
    expect(shrinkGuardFromEnv({})).toEqual(DEFAULT_SHRINK_GUARD);
    expect(() => shrinkGuardFromEnv({ INGEST_MAX_DELETE_FRACTION: '10' })).toThrow(
      /between 0 and 1/,
    );
  });
});

describe('truncated upstream files', () => {
  it('fails an empty-but-valid legislators file and keeps every row', async () => {
    const rt = await testRuntime(handle);
    const good = await ingestFixture(rt, 'congress-legislators');
    expect(good.status).toBe('succeeded');
    const before = await tableCounts(handle.db);

    const empty = await copyFixture('congress-legislators');
    await writeFile(join(empty, 'legislators-current.json'), '[]');
    await writeFile(join(empty, 'legislators-historical.json'), '[]');
    const receipt = await ingestFixture(rt, 'congress-legislators', empty);

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard: .*Rolled back; no rows were changed/s);
    expect(receipt.error).toMatch(/would delete \d+ of \d+ existing rows/);
    const after = await tableCounts(handle.db);
    expect({ ...after, ingest_run: 0 }).toEqual({ ...before, ingest_run: 0 });
  });

  it('fails a file cut to a fraction of the previous run (stale sweep rolled back)', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const before = await tableCounts(handle.db);

    const cut = await copyFixture('congress-legislators');
    const current = JSON.parse(
      await readFile(join(cut, 'legislators-current.json'), 'utf8'),
    ) as unknown[];
    await writeFile(join(cut, 'legislators-current.json'), JSON.stringify(current.slice(0, 2)));
    const receipt = await ingestFixture(rt, 'congress-legislators', cut);

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/^shrink guard:/);
    expect((await tableCounts(handle.db)).term).toBe(before.term);
    expect((await tableCounts(handle.db)).person_identifier).toBe(before.person_identifier);
  });

  it('applies a truncated file when the operator passes --allow-shrink', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const before = await tableCounts(handle.db);

    const empty = await copyFixture('congress-legislators');
    await writeFile(join(empty, 'legislators-current.json'), '[]');
    await writeFile(join(empty, 'legislators-historical.json'), '[]');
    const override = await testRuntime(handle, {
      shrinkGuard: { ...DEFAULT_SHRINK_GUARD, allow: true },
    });
    const receipt = await ingestFixture(override, 'congress-legislators', empty);

    expect(receipt.status).toBe('succeeded');
    expect(receipt.counts.stale_terms_deleted).toBe(before.term);
    expect((await tableCounts(handle.db)).term).toBe(0);
  });

  it('fails a votes file whose record count collapses against the last run', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const good = await ingestFixture(rt, 'voteview');
    expect(good.status).toBe('succeeded');

    const cut = await copyFixture('voteview');
    const votes = (await readFile(join(cut, 'HS119_votes.csv'), 'utf8')).trimEnd().split('\n');
    await writeFile(join(cut, 'HS119_votes.csv'), `${votes.slice(0, 3).join('\n')}\n`);
    await writeFile(
      join(cut, 'HS119_rollcalls.csv'),
      (await readFile(join(cut, 'HS119_rollcalls.csv'), 'utf8')).split('\n').slice(0, 2).join('\n'),
    );
    const receipt = await ingestFixture(rt, 'voteview', cut);

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/loaded \d+ records against \d+ in the last successful run/);
    const [positions] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from vote_position`,
    );
    expect(positions?.n).toBe(18);
  });

  it('does not block a first load or an unchanged rerun', async () => {
    const rt = await testRuntime(handle);
    expect((await ingestFixture(rt, 'congress-legislators')).status).toBe('succeeded');
    expect((await ingestFixture(rt, 'congress-legislators')).deduplicated).toBe(true);
  });
});
