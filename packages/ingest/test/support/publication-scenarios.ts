import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db, DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { ADAPTERS } from '../../src/adapters/registry';
import type { IngestRuntime } from '../../src/runtime/run';
import { FIXTURES, ingestFixture, rows, testRuntime } from '../helpers';

/**
 * H3-01 publication-boundary scenarios, shared by the PGlite suite (publication.test.ts)
 * and the Postgres suite (test-pg/publication.pgtest.ts) so both drivers run the same
 * checks. Each scenario loads a good legislators snapshot, then a second snapshot that
 * renames one member to MARKER and fails at one publication step. Whatever the step, the
 * facts, both read models and the receipt must agree: nothing from the failed run is
 * visible and the receipt does not claim success.
 */
export const MARKER = 'H3 Publication Marker';
const VERSION = 'congress-legislators@publication-test';

export async function markedSnapshot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-marked-'));
  await cp(join(FIXTURES, 'congress-legislators'), dir, { recursive: true });
  const path = join(dir, 'legislators-current.json');
  const people = JSON.parse(await readFile(path, 'utf8')) as {
    name: { official_full?: string };
  }[];
  const first = people[0];
  if (!first) throw new Error('empty legislators fixture');
  first.name.official_full = MARKER;
  await writeFile(path, JSON.stringify(people));
  return dir;
}

export interface PublishedState {
  markerFacts: number;
  markerCards: number;
  cardRefreshedAt: string | null;
  scorecardRows: number;
}

export async function publishedState(handle: DbHandle): Promise<PublishedState> {
  const [state] = await rows<PublishedState>(
    handle.db,
    sql`select
      (select count(*) from person where full_name = ${MARKER})::int as "markerFacts",
      (select count(*) from person_card where full_name = ${MARKER})::int as "markerCards",
      (select max(refreshed_at)::text from person_card) as "cardRefreshedAt",
      (select count(*) from person_card_scorecard)::int as "scorecardRows"`,
  );
  if (!state) throw new Error('no state row');
  return state;
}

const bumped = (handle: DbHandle, overrides: Partial<IngestRuntime> = {}) =>
  testRuntime(handle, {
    adapters: {
      ...ADAPTERS,
      'congress-legislators': { ...ADAPTERS['congress-legislators'], version: VERSION },
    },
    ...overrides,
  });

const refreshView = (db: Db, view: 'person_card' | 'person_card_scorecard') =>
  db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`));

/** Raises inside the database when this test's run is about to be recorded as succeeded. */
async function failSucceededReceipt(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`
    create or replace function h3_fail_succeeded_receipt() returns trigger
    language plpgsql as $$
    begin
      if new.status = 'succeeded' and new.adapter_version = ${sql.raw(`'${VERSION}'`)} then
        raise exception 'injected final ledger write failure';
      end if;
      return new;
    end $$`);
  await handle.db.execute(sql`
    create trigger h3_fail_succeeded_receipt before update on ingest_run
    for each row execute function h3_fail_succeeded_receipt()`);
}

async function expectUnpublished(handle: DbHandle, before: PublishedState, runId: number) {
  expect(await publishedState(handle)).toEqual(before);
  const [run] = await rows<{ status: string }>(
    handle.db,
    sql`select status::text as status from ingest_run where id = ${runId}`,
  );
  expect(run?.status).not.toBe('succeeded');
}

export function publicationScenarios(getHandle: () => DbHandle): void {
  const baseline = async () => {
    const handle = getHandle();
    const good = await ingestFixture(await testRuntime(handle), 'congress-legislators');
    expect(good.status).toBe('succeeded');
    const before = await publishedState(handle);
    expect(before.markerFacts).toBe(0);
    return { handle, before };
  };

  it('refresh 1 fails: no facts, no read model and no success receipt are published', async () => {
    const { handle, before } = await baseline();
    const rt = await bumped(handle, {
      refreshReadModel: async () => {
        throw new Error('injected refresh-1 failure');
      },
    });
    const receipt = await ingestFixture(rt, 'congress-legislators', await markedSnapshot());
    expect(receipt.status).toBe('failed');
    await expectUnpublished(handle, before, receipt.runId);
    expect(receipt.error).toMatch(/injected refresh-1 failure/);
  });

  it('refresh 2 fails after refresh 1: the first read model is not left ahead of the second', async () => {
    const { handle, before } = await baseline();
    const rt = await bumped(handle, {
      refreshReadModel: async (db) => {
        await refreshView(db, 'person_card');
        throw new Error('injected refresh-2 failure');
      },
    });
    const receipt = await ingestFixture(rt, 'congress-legislators', await markedSnapshot());
    expect(receipt.status).toBe('failed');
    await expectUnpublished(handle, before, receipt.runId);
    expect(receipt.error).toMatch(/injected refresh-2 failure/);
  });

  it('the final ledger write fails: the facts and read models roll back with it', async () => {
    const { handle, before } = await baseline();
    await failSucceededReceipt(handle);
    const receipt = await ingestFixture(await bumped(handle), 'congress-legislators', await markedSnapshot());
    expect(receipt.status).toBe('failed');
    await expectUnpublished(handle, before, receipt.runId);
    expect(receipt.error).toMatch(/injected final ledger write failure/);
  });
}
