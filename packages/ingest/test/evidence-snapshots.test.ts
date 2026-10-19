import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch, type IngestRunReceipt, type IngestScope } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceAdapter } from '../src/adapter';
import { ADAPTERS } from '../src/adapters/registry';
import { type IngestRuntime, runIngest } from '../src/runtime/run';
import { freshDb, ingestFixture, rows, SCOPES, tableCounts, testRuntime } from './helpers';
import {
  type EvidenceServer,
  evidenceServer,
  expectEvidenceIntact,
  renamedLegislators,
} from './support/evidence';

/**
 * Evidence trust, T-A (docs/evidence/evidence-trust-20261019-contract.md, F1/F2): every
 * run's raw evidence stays retrievable and unaltered, and an unchanged recheck is recorded
 * as a check instead of disappearing. Mocked HTTP only.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

type Receipt = IngestRunReceipt & {
  snapshotLocator?: string | null;
  check?: { id: number; checkedAt: string } | null;
};

const CURRENT = 'legislators-current.json';

function fetchRun(rt: IngestRuntime, source: keyof typeof SCOPES, scope?: IngestScope) {
  return runIngest({ source, scope: scope ?? SCOPES[source] }, rt) as Promise<Receipt>;
}

async function legislatorsServer(): Promise<EvidenceServer> {
  return evidenceServer('congress-legislators');
}

function publish(server: EvidenceServer, name: string): void {
  const body = server.files.get(CURRENT);
  if (!body) throw new Error('fixture missing');
  server.files.set(CURRENT, renamedLegislators(body, name));
}

/** congress-legislators whose parse calls `onRecord(i)` before yielding record i. */
function instrumented(onRecord: (i: number) => void): IngestRuntime['adapters'] {
  const base = ADAPTERS['congress-legislators'];
  const adapter = {
    ...base,
    parse: async function* (snapshot, scope) {
      let i = 0;
      for await (const record of base.parse(snapshot, scope)) {
        onRecord(i++);
        yield record;
      }
    },
  } as SourceAdapter<unknown>;
  return { ...ADAPTERS, 'congress-legislators': adapter } as IngestRuntime['adapters'];
}

describe('raw evidence retention (F1)', () => {
  it('R1: two changed same-day snapshots stay individually retrievable and rehash to their own checksums', async () => {
    const server = await legislatorsServer();
    const rt = await testRuntime(handle, { http: server.deps });
    const first = await fetchRun(rt, 'congress-legislators');
    publish(server, 'Evidence Marker One');
    const second = await fetchRun(rt, 'congress-legislators');
    expect([first.status, second.status]).toEqual(['succeeded', 'succeeded']);
    expect(second.snapshotChecksum).not.toBe(first.snapshotChecksum);
    expect(first.startedAt.slice(0, 10)).toBe(second.startedAt.slice(0, 10));

    await expectEvidenceIntact(rt.rawRoot, first);
    await expectEvidenceIntact(rt.rawRoot, second);
    // Each run names its own evidence, relative to the raw root, and the ledger agrees.
    expect(first.snapshotLocator).toMatch(
      /^congress-legislators\/\d{4}-\d{2}-\d{2}\/\d+-[0-9a-f]{12}$/,
    );
    expect(second.snapshotLocator).not.toBe(first.snapshotLocator);
    const ledger = await rows<{ id: number; snapshot_locator: string | null }>(
      handle.db,
      sql`select id, snapshot_locator from ingest_run order by id`,
    );
    expect(ledger).toEqual([
      { id: first.runId, snapshot_locator: first.snapshotLocator },
      { id: second.runId, snapshot_locator: second.snapshotLocator },
    ]);
  });

  it('R2: a later parse failure, cancelled load and failed publication cannot alter the earlier successful run’s evidence', async () => {
    const server = await legislatorsServer();
    const rt = await testRuntime(handle, { http: server.deps });
    const good = await fetchRun(rt, 'congress-legislators');
    expect(good.status).toBe('succeeded');
    await expectEvidenceIntact(rt.rawRoot, good);

    // 1. Parse failure: upstream publishes malformed JSON.
    server.files.set(CURRENT, Buffer.from('[{"id": '));
    const parseFailure = await fetchRun(rt, 'congress-legislators');
    expect(parseFailure.status).toBe('failed');
    await expectEvidenceIntact(rt.rawRoot, good);

    // 2. Cancelled load: a changed file, aborted part-way through the load.
    publish(server, 'Evidence Marker Cancelled');
    const abort = new AbortController();
    const cancelled = (await runIngest(
      { source: 'congress-legislators', scope: SCOPES['congress-legislators'] },
      {
        ...rt,
        signal: abort.signal,
        adapters: instrumented((i) => {
          if (i === 3) abort.abort(new Error('interrupted (SIGINT)'));
        }),
      },
    )) as Receipt;
    expect(cancelled.status).toBe('cancelled');
    await expectEvidenceIntact(rt.rawRoot, good);

    // 3. Failed publication: the read-model refresh fails inside the load transaction.
    publish(server, 'Evidence Marker Unpublished');
    const unpublished = (await runIngest(
      { source: 'congress-legislators', scope: SCOPES['congress-legislators'] },
      {
        ...rt,
        refreshReadModel: async () => {
          throw new Error('injected refresh failure');
        },
      },
    )) as Receipt;
    expect(unpublished.status).toBe('failed');
    await expectEvidenceIntact(rt.rawRoot, good);

    // The failed attempts kept their own evidence for diagnosis, each at its own locator.
    const locators = [good, parseFailure, cancelled, unpublished].map((r) => r.snapshotLocator);
    expect(new Set(locators).size).toBe(4);
    await expectEvidenceIntact(rt.rawRoot, cancelled);
    await expectEvidenceIntact(rt.rawRoot, unpublished);
  });

  it('R3: two scopes fetched on the same day retain distinct valid manifests', async () => {
    const rt0 = await testRuntime(handle);
    await ingestFixture(rt0, 'congress-legislators');
    const server = await evidenceServer('voteview');
    for (const [name, body] of [...server.files]) {
      server.files.set(name.replace('HS119_', 'HS118_'), body);
    }
    const rt = await testRuntime(handle, { http: server.deps, rawRoot: rt0.rawRoot });
    const c119 = await fetchRun(rt, 'voteview', { kind: 'congress', congress: 119 });
    const c118 = await fetchRun(rt, 'voteview', { kind: 'congress', congress: 118 });
    expect(c119.status).toBe('succeeded');
    expect(c118.scope).toBe('congress:118');
    const m119 = await expectEvidenceIntact(rt.rawRoot, c119);
    const m118 = await expectEvidenceIntact(rt.rawRoot, c118);
    expect(m119.scope).toBe('congress:119');
    expect(m118.scope).toBe('congress:118');
    expect((m119.files as { fileName: string }[]).map((f) => f.fileName).sort()).toEqual([
      'HS119_members.csv',
      'HS119_rollcalls.csv',
      'HS119_votes.csv',
    ]);
  });
});

interface Freshness {
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastSuccessfulCheckAt: string | null;
  lastChangedAt: string | null;
  coverageThrough: string | null;
  coverageBasis: string | null;
}
interface ScopeFreshness {
  scope: string;
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastSuccessfulCheckAt: string | null;
  lastChangedAt: string | null;
  publicationRunId: number | null;
  coverageThrough: string | null;
}
interface StatusSource {
  id: string;
  lastRun: { id: number; status: string; startedAt: string; finishedAt: string | null } | null;
  lastSuccess: { id: number; finishedAt: string | null } | null;
  freshness?: Freshness;
  scopes?: ScopeFreshness[];
}

async function statusOf(id: string): Promise<StatusSource> {
  const status = (await dispatch('sources.status', {}, { db: handle.db })) as unknown as {
    sources: StatusSource[];
  };
  const found = status.sources.find((s) => s.id === id);
  if (!found) throw new Error(`no ${id} in sources.status`);
  return found;
}

describe('unchanged rechecks (F2)', () => {
  it('R4: an identical successful recheck keeps the publication receipt and facts, and adds check history shown by sources.status', async () => {
    const server = await legislatorsServer();
    const rt = await testRuntime(handle, { http: server.deps });
    const published = await fetchRun(rt, 'congress-legislators');
    expect(published.status).toBe('succeeded');
    const facts = await tableCounts(handle.db);
    const before = await statusOf('congress-legislators');

    const recheck = await fetchRun(rt, 'congress-legislators');
    // Same publication receipt (idempotency unchanged), plus the check that confirmed it.
    const { check, ...receipt } = recheck;
    expect(receipt).toEqual({ ...published, check: undefined, deduplicated: true });
    expect(check).toEqual({ id: expect.any(Number), checkedAt: expect.any(String) });
    expect(await tableCounts(handle.db)).toEqual(facts);

    const checks = await rows<{
      id: number;
      source_id: string;
      scope: string;
      outcome: string;
      snapshot_checksum: string;
      adapter_version: string;
      publication_run_id: number;
      started_at: string;
      checked_at: string;
    }>(handle.db, sql`select * from ingest_check`);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      id: check?.id,
      source_id: 'congress-legislators',
      scope: 'all',
      outcome: 'unchanged',
      snapshot_checksum: published.snapshotChecksum,
      adapter_version: published.adapterVersion,
      publication_run_id: published.runId,
    });

    const after = await statusOf('congress-legislators');
    // v1 fields exactly as before the recheck.
    expect(after.lastRun).toEqual(before.lastRun);
    expect(after.lastSuccess).toEqual(before.lastSuccess);
    expect(after.freshness).toMatchObject({
      lastAttemptOutcome: 'unchanged',
      lastSuccessfulCheckAt: check?.checkedAt,
      lastChangedAt: published.finishedAt,
    });
    expect(Date.parse(after.freshness?.lastAttemptAt ?? '')).toBeGreaterThan(
      Date.parse(published.startedAt),
    );
    expect(after.scopes).toEqual([
      expect.objectContaining({
        scope: 'all',
        lastAttemptOutcome: 'unchanged',
        lastSuccessfulCheckAt: check?.checkedAt,
        lastChangedAt: published.finishedAt,
        publicationRunId: published.runId,
      }),
    ]);

    // The unchanged fetch did not keep a duplicate copy of the publication's evidence.
    const day = published.startedAt.slice(0, 10);
    expect(await readdir(join(rt.rawRoot, 'congress-legislators', day))).toHaveLength(1);
    await expectEvidenceIntact(rt.rawRoot, published);
  });

  it('R6: coverageThrough stays the source’s own data date even when checks are recent', async () => {
    const rt0 = await testRuntime(handle);
    await ingestFixture(rt0, 'congress-legislators');
    await ingestFixture(rt0, 'fec-bulk');
    await ingestFixture(rt0, 'govinfo-billstatus');
    const server = await evidenceServer('voteview');
    const rt = await testRuntime(handle, { http: server.deps });
    const votes = await fetchRun(rt, 'voteview');
    const recheck = await fetchRun(rt, 'voteview');
    expect([votes.status, recheck.deduplicated]).toEqual(['succeeded', true]);

    const [expected] = await rows<{ votes: string; money: string | null; bills: string | null }>(
      handle.db,
      sql`select
        (select max(vote_date)::text from rollcall where congress = 119) as votes,
        (select max(coverage_end_date)::text from candidate_cycle_totals where cycle = 2026) as money,
        (select max(latest_action_date)::text from bill where congress = 119) as bills`,
    );
    expect(expected?.votes).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Date().toISOString().slice(0, 10);
    expect(expected?.votes).not.toBe(today);

    const voteview = await statusOf('voteview');
    expect(voteview.freshness?.coverageThrough).toBe(expected?.votes);
    expect(voteview.freshness?.coverageBasis).toEqual(expect.any(String));
    expect(voteview.freshness?.lastSuccessfulCheckAt?.slice(0, 10)).toBe(today);
    expect(voteview.scopes).toEqual([
      expect.objectContaining({ scope: 'congress:119', coverageThrough: expected?.votes }),
    ]);
    expect((await statusOf('fec-bulk')).freshness?.coverageThrough).toBe(expected?.money ?? null);
    expect((await statusOf('govinfo-billstatus')).freshness?.coverageThrough).toBe(
      expected?.bills ?? null,
    );
    const legislators = await statusOf('congress-legislators');
    expect(legislators.freshness?.coverageThrough).toBeNull();
    expect(legislators.freshness?.coverageBasis).toEqual(expect.any(String));
  });
});
