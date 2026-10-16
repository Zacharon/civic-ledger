import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpDeps } from '../src/runtime/http';
import { runIngest } from '../src/runtime/run';
import { MANIFEST_FILE } from '../src/runtime/snapshot';
import { FIXTURES, freshDb, ingestFixture, rows, SCOPES, testRuntime } from './helpers';
import { MARKER, markedSnapshot } from './support/publication-scenarios';

let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

const markerRows = async () => {
  const [row] = await rows<{ n: number }>(
    handle.db,
    sql`select count(*)::int as n from person where full_name = ${MARKER}`,
  );
  return row?.n ?? 0;
};

describe('snapshot replay A -> B -> A (H3-07, probe P2)', () => {
  const A = join(FIXTURES, 'congress-legislators');

  it('refuses to treat an old snapshot as restoration and says how to replay it', async () => {
    const rt = await testRuntime(handle);
    const first = await ingestFixture(rt, 'congress-legislators', A);
    const b = await ingestFixture(rt, 'congress-legislators', await markedSnapshot());
    expect([first.status, b.status]).toEqual(['succeeded', 'succeeded']);
    expect(await markerRows()).toBe(1);

    const again = await ingestFixture(rt, 'congress-legislators', A);
    expect(again.deduplicated).toBe(false);
    expect(again.status).toBe('failed');
    expect(again.error).toMatch(/^snapshot_superseded: .*run \d+ .*--force-replay/s);
    expect(await markerRows()).toBe(1);
  });

  it('--force-replay loads the old snapshot as a new current run and names the original', async () => {
    const rt = await testRuntime(handle);
    const first = await ingestFixture(rt, 'congress-legislators', A);
    await ingestFixture(rt, 'congress-legislators', await markedSnapshot());

    const replay = await runIngest(
      { source: 'congress-legislators', scope: SCOPES['congress-legislators'], snapshotPath: A, forceReplay: true },
      rt,
    );
    expect(replay).toMatchObject({ status: 'succeeded', deduplicated: false, replayOf: first.runId });
    expect(replay.runId).not.toBe(first.runId);
    expect(await markerRows()).toBe(0);
  });

  it('still deduplicates an immediate repeat of the current snapshot', async () => {
    const rt = await testRuntime(handle);
    const first = await ingestFixture(rt, 'congress-legislators', A);
    const again = await ingestFixture(rt, 'congress-legislators', A);
    expect(again).toEqual({ ...first, deduplicated: true });
  });
});

describe('raw snapshot manifest schema version (H3-08)', () => {
  async function snapshotWithManifest(manifest: Record<string, unknown> | null): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'civic-manifest-'));
    await cp(A(), dir, { recursive: true });
    if (manifest) await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest));
    return dir;
  }
  const A = () => join(FIXTURES, 'congress-legislators');

  it('writes schema_version 1 into every fetched manifest', async () => {
    const deps: HttpDeps = {
      fetch: async (input) =>
        new Response(await readFile(join(FIXTURES, 'voteview', String(input).split('/').at(-1) ?? '')), {
          status: 200,
        }),
      sleep: async () => {},
      random: () => 0,
    };
    const rt = await testRuntime(handle, { http: deps });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await runIngest({ source: 'voteview', scope: SCOPES.voteview }, rt);
    expect(receipt.status).toBe('succeeded');
    const day = new Date().toISOString().slice(0, 10);
    const manifest = JSON.parse(await readFile(join(rt.rawRoot, 'voteview', day, MANIFEST_FILE), 'utf8'));
    expect(manifest.schema_version).toBe(1);
  });

  it('accepts a v1 manifest and a legacy manifest without a version', async () => {
    const rt = await testRuntime(handle);
    const v1 = await ingestFixture(
      rt,
      'congress-legislators',
      await snapshotWithManifest({ schema_version: 1, source: 'congress-legislators', files: [] }),
    );
    expect(v1.status).toBe('succeeded');
    const legacy = await ingestFixture(
      await testRuntime(handle),
      'congress-legislators',
      await snapshotWithManifest({ source: 'congress-legislators', files: [] }),
    );
    expect(legacy.status).toBe('succeeded');
  });

  it('rejects a snapshot whose manifest has an unknown schema version', async () => {
    const rt = await testRuntime(handle);
    const receipt = await ingestFixture(
      rt,
      'congress-legislators',
      await snapshotWithManifest({ schema_version: 99, source: 'congress-legislators', files: [] }),
    );
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/manifest schema_version 99 is not supported/);
  });
});
