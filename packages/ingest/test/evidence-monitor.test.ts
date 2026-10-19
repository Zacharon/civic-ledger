import { dispatch, type IngestRunReceipt } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assess,
  normalizeSources,
  type Observation,
  SOURCE_POLICY,
} from '../../../scripts/monitor/assess';
import { runIngest } from '../src/runtime/run';
import { freshDb, ingestFixture, SCOPES, testRuntime } from './helpers';
import { evidenceServer } from './support/evidence';

/**
 * Evidence trust, T-A (F2): the monitor reads `sources.status` from a real PGlite ledger.
 * A failed fetch followed by a successful unchanged validation must clear the failed and
 * missed findings; a check of one scope must not vouch for another.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

async function observe(time: Date, expectedScopes?: Record<string, string>): Promise<Observation> {
  const status = (await dispatch('sources.status', {}, { db: handle.db })) as { sources: unknown };
  return {
    time: time.toISOString(),
    liveStatus: 200,
    readyStatus: 200,
    sources: normalizeSources(status.sources),
    backupTakenAt: time.toISOString(),
    backupAuthenticated: true,
    rawBackupTakenAt: time.toISOString(),
    rawBackupAuthenticated: true,
    ...(expectedScopes ? { expectedScopes } : {}),
  } as Observation;
}

const keysFor = (findings: { key: string }[], id: string) =>
  findings.map((f) => f.key).filter((key) => key.startsWith(`ingest:${id}:`));

/** Moves every ledger row of a source back by `hours` (the test's simulated past). */
async function age(source: string, hours: number): Promise<void> {
  const shift = sql.raw(`interval '${hours} hours'`);
  await handle.db.execute(
    sql`update ingest_run set started_at = started_at - ${shift}, finished_at = finished_at - ${shift} where source_id = ${source}`,
  );
}

describe('monitor over a real ledger (R5)', () => {
  it('a failed fetch, then a successful unchanged validation, clears the failed and missed findings', async () => {
    const id = 'congress-legislators';
    const policy = SOURCE_POLICY[id];
    const server = await evidenceServer(id);
    const rt = await testRuntime(handle, { http: server.deps });
    const input = { source: id, scope: SCOPES[id] } as const;

    const published = (await runIngest(input, rt)) as IngestRunReceipt;
    expect(published.status).toBe('succeeded');
    server.failWith = 503;
    const failed = (await runIngest(input, rt)) as IngestRunReceipt;
    expect(failed.status).toBe('failed');
    // Both receipts are older than the attempt and freshness windows.
    await age(id, policy.freshHours + 1);

    const broken = assess(await observe(new Date()));
    expect(keysFor(broken, id).sort()).toEqual([
      `ingest:${id}:failed`,
      `ingest:${id}:missed`,
      `ingest:${id}:stale`,
    ]);

    server.failWith = null;
    const recheck = (await runIngest(input, rt)) as IngestRunReceipt;
    expect(recheck).toMatchObject({ runId: published.runId, deduplicated: true });

    const status = await observe(new Date());
    expect(keysFor(assess(status), id)).toEqual([]);
    // The v1 view still reports the failed run as the latest run row.
    const source = status.sources?.find((s) => s.id === id);
    expect(source?.lastRun?.status).toBe('failed');
  });

  it('a recent check of another Congress does not make the expected scope fresh', async () => {
    const legislators = await testRuntime(handle);
    await ingestFixture(legislators, 'congress-legislators');
    const server = await evidenceServer('voteview');
    for (const [name, body] of [...server.files]) {
      server.files.set(name.replace('HS119_', 'HS118_'), body);
    }
    const rt = await testRuntime(handle, { http: server.deps });
    const c119 = (await runIngest(
      { source: 'voteview', scope: { kind: 'congress', congress: 119 } },
      rt,
    )) as IngestRunReceipt;
    expect(c119.status).toBe('succeeded');
    await age('voteview', SOURCE_POLICY.voteview.freshHours + 1);
    // A historical Congress is fetched (and then rechecked) now.
    await runIngest({ source: 'voteview', scope: { kind: 'congress', congress: 118 } }, rt);
    await runIngest({ source: 'voteview', scope: { kind: 'congress', congress: 118 } }, rt);

    const scoped = assess(await observe(new Date(), { voteview: 'congress:119' }));
    expect(keysFor(scoped, 'voteview').sort()).toEqual([
      'ingest:voteview:missed',
      'ingest:voteview:stale',
    ]);
    const historical = assess(await observe(new Date(), { voteview: 'congress:118' }));
    expect(keysFor(historical, 'voteview')).toEqual([]);
  });
});
