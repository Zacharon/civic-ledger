import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityError, RUN_IN_PROGRESS } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceAdapter } from '../src/adapter';
import { ADAPTERS } from '../src/adapters/registry';
import type { HttpDeps } from '../src/runtime/http';
import { runIngest } from '../src/runtime/run';
import { MANIFEST_FILE } from '../src/runtime/snapshot';
import {
  curatedFixture,
  FIXTURES,
  freshDb,
  ingestFixture,
  insertFictionalPerson,
  rows,
  SCOPES,
  tableCounts,
  testRuntime,
} from './helpers';

let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

const withVersion = <T>(adapter: SourceAdapter<T>, version: string): SourceAdapter<T> => ({
  ...adapter,
  version,
});

describe('idempotency', () => {
  it('returns the original run for the same (source, adapterVersion, snapshotChecksum) and writes nothing', async () => {
    const rt = await testRuntime(handle);
    const first = await ingestFixture(rt, 'congress-legislators');
    const before = await tableCounts(handle.db);
    const again = await ingestFixture(rt, 'congress-legislators');
    expect(again).toEqual({ ...first, deduplicated: true });
    expect(await tableCounts(handle.db)).toEqual(before);
  });

  it('converges on natural keys when the same data is loaded again under a new run', async () => {
    const rt = await testRuntime(handle);
    for (const source of [
      'congress-legislators',
      'voteview',
      'fec-bulk',
      'govinfo-billstatus',
    ] as const) {
      await ingestFixture(rt, source);
    }
    const before = await tableCounts(handle.db);
    const bumped = await testRuntime(handle, {
      adapters: {
        ...ADAPTERS,
        'fec-bulk': withVersion(ADAPTERS['fec-bulk'], 'fec-bulk@test'),
        'govinfo-billstatus': withVersion(
          ADAPTERS['govinfo-billstatus'],
          'govinfo-billstatus@test',
        ),
      },
    });
    const fec = await ingestFixture(bumped, 'fec-bulk');
    const bills = await ingestFixture(bumped, 'govinfo-billstatus');
    expect([fec.deduplicated, bills.deduplicated]).toEqual([false, false]);
    expect(fec.counts.stale_rows_deleted).toBe(0);
    expect(await tableCounts(handle.db)).toEqual({
      ...before,
      ingest_run: (before.ingest_run ?? 0) + 2,
    });
    const [stamp] = await rows<{ run: number }>(
      handle.db,
      sql`select max(ingest_run_id)::int as run from committee_contribution`,
    );
    expect(stamp?.run).toBe(fec.runId);
  });

  it('does not dedupe a dependent source after its upstream was reloaded', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const votes = await ingestFixture(rt, 'voteview');
    const reloaded = await testRuntime(handle, {
      adapters: {
        ...ADAPTERS,
        'congress-legislators': withVersion(ADAPTERS['congress-legislators'], 'cl@test'),
      },
    });
    await ingestFixture(reloaded, 'congress-legislators');
    const again = await ingestFixture(rt, 'voteview');
    expect(again.deduplicated).toBe(false);
    expect(again.snapshotChecksum).not.toBe(votes.snapshotChecksum);
  });
});

describe('locking', () => {
  it('refuses a concurrent run of the same source with conflict: run_in_progress', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = ADAPTERS['congress-legislators'];
    const rt = await testRuntime(handle, {
      adapters: {
        ...ADAPTERS,
        'congress-legislators': {
          ...slow,
          plan: async (scope, ctx) => {
            await gate;
            return slow.plan(scope, ctx);
          },
        },
      },
    });
    const first = ingestFixture(rt, 'congress-legislators');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await ingestFixture(rt, 'congress-legislators').then(
      () => null,
      (e: unknown) => e,
    );
    expect(second).toBeInstanceOf(CapabilityError);
    expect(second).toMatchObject({ code: 'conflict' });
    expect((second as CapabilityError).message.startsWith(RUN_IN_PROGRESS)).toBe(true);
    release();
    expect((await first).status).toBe('succeeded');
    const [runs] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from ingest_run`,
    );
    expect(runs?.n).toBe(1);
    // The lock is released afterwards.
    expect((await ingestFixture(rt, 'congress-legislators')).deduplicated).toBe(true);
  });

  it('marks a running row left by a dead process as failed before the next run', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    await handle.db.execute(
      sql`insert into ingest_run (source_id, adapter_version, scope) values ('congress-legislators', 'x', 'all')`,
    );
    await ingestFixture(rt, 'congress-legislators');
    const [stale] = await rows<{ status: string; error: string }>(
      handle.db,
      sql`select status, error from ingest_run where adapter_version = 'x'`,
    );
    expect(stale).toMatchObject({ status: 'failed', error: expect.stringMatching(/^abandoned/) });
  });
});

describe('failures', () => {
  it('records a failed receipt (no read-model refresh) when the snapshot is incomplete', async () => {
    const rt = await testRuntime(handle);
    const empty = await mkdtemp(join(tmpdir(), 'civic-empty-'));
    const receipt = await ingestFixture(rt, 'voteview', empty);
    expect(receipt).toMatchObject({
      status: 'failed',
      deduplicated: false,
      readModelRefreshedAfter: null,
    });
    expect(receipt.error).toMatch(/missing HS119_members\.csv/);
    expect(receipt.finishedAt).not.toBeNull();
  });

  it('fails mid-load on a corrupt file and converges when rerun with a good snapshot', async () => {
    const rt = await testRuntime(handle);
    await ingestFixture(rt, 'congress-legislators');
    const broken = await mkdtemp(join(tmpdir(), 'civic-broken-'));
    await cp(join(FIXTURES, 'voteview'), broken, { recursive: true });
    const votes = await readFile(join(broken, 'HS119_votes.csv'), 'utf8');
    await writeFile(
      join(broken, 'HS119_votes.csv'),
      `${votes.trimEnd()}\n119,House,144,21333,42,1.0\n`,
    );
    const failed = await ingestFixture(rt, 'voteview', broken);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Unknown Voteview cast_code 42/);
    const good = await ingestFixture(rt, 'voteview');
    expect(good.status).toBe('succeeded');
    const [positions] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from vote_position`,
    );
    expect(positions?.n).toBe(18);
  });

  it('rejects scopes and sources the adapters do not support', async () => {
    const rt = await testRuntime(handle);
    await expect(
      runIngest({ source: 'voteview', scope: { kind: 'cycle', cycle: 2026 } }, rt),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      runIngest({ source: 'openstates', scope: { kind: 'all' } }, rt),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      runIngest({ source: 'voteview', scope: { kind: 'congress', congress: 119 }, extra: 1 }, rt),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

describe('fetching', () => {
  /** Serves fixture files by URL basename with ETags; 304 when the ETag matches. */
  function fixtureServer(dir: string, failFirst: string | null = null) {
    const requests: { url: string; conditional: boolean }[] = [];
    let failed = false;
    const deps: HttpDeps = {
      fetch: async (input, init) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const name = url.split('/').at(-1) ?? '';
        requests.push({ url, conditional: Boolean(headers['if-none-match']) });
        if (name === failFirst && !failed) {
          failed = true;
          return new Response('busy', { status: 503 });
        }
        const etag = `"${name}-v1"`;
        if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
        return new Response(await readFile(join(dir, name)), { status: 200, headers: { etag } });
      },
      sleep: async () => {},
      random: () => 0,
    };
    return { deps, requests };
  }

  it('downloads into data/raw/<source>/<date>/ with a manifest, retries a 503, then dedupes via 304', async () => {
    const server = fixtureServer(join(FIXTURES, 'voteview'), 'HS119_rollcalls.csv');
    const rt = await testRuntime(handle, { http: server.deps });
    await ingestFixture(rt, 'congress-legislators');
    const first = await runIngest({ source: 'voteview', scope: SCOPES.voteview }, rt);
    expect(first.status).toBe('succeeded');
    expect(server.requests.filter((r) => r.url.endsWith('HS119_rollcalls.csv'))).toHaveLength(2);

    const day = new Date().toISOString().slice(0, 10);
    const dir = join(rt.rawRoot, 'voteview', day);
    expect((await readdir(dir)).sort()).toEqual([
      'HS119_members.csv',
      'HS119_rollcalls.csv',
      'HS119_votes.csv',
      MANIFEST_FILE,
    ]);
    const manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
    expect(manifest.checksum).toBe(first.snapshotChecksum);
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    const second = await runIngest({ source: 'voteview', scope: SCOPES.voteview }, rt);
    expect(second).toEqual({ ...first, deduplicated: true });
    expect(server.requests.slice(-3).every((r) => r.conditional)).toBe(true);
  });
});

describe('curated', () => {
  it('fails with file:line messages on invalid YAML and loads nothing', async () => {
    const rt = await testRuntime(handle);
    const dir = await curatedFixture();
    await writeFile(
      join(dir, 'platforms', 'X000001-2026.yaml'),
      'schema_version: 1\nperson:\n  bioguide: nope\n',
    );
    const receipt = await ingestFixture(rt, 'curated', dir);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/platforms\/X000001-2026\.yaml:3: person\.bioguide/);
    const [areas] = await rows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from policy_area`,
    );
    expect(areas?.n).toBe(0);
  });

  it('deletes curated rows whose file was removed in git', async () => {
    const rt = await testRuntime(handle);
    for (const source of ['congress-legislators', 'voteview', 'govinfo-billstatus'] as const)
      await ingestFixture(rt, source);
    await insertFictionalPerson(handle.db);
    const dir = await curatedFixture();
    expect((await ingestFixture(rt, 'curated', dir)).counts.promises).toBe(1);
    await rm(join(dir, 'promises', 'X000001.yaml'));
    const after = await ingestFixture(rt, 'curated', dir);
    expect(after.counts.stale_rows_deleted).toBe(2);
    const [left] = await rows<{ promises: number; ratings: number }>(
      handle.db,
      sql`select (select count(*) from promise)::int as promises, (select count(*) from promise_rating)::int as ratings`,
    );
    expect(left).toEqual({ promises: 0, ratings: 0 });
  });
});
