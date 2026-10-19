import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IngestRunReceipt } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveRaw, restoreRaw } from '../../../scripts/backup/raw';
import { createStore } from '../../../scripts/backup/storage';
import { runIngest } from '../src/runtime/run';
import { freshDb, SCOPES, testRuntime } from './helpers';
import { evidenceServer, expectEvidenceIntact, renamedLegislators } from './support/evidence';

/**
 * Evidence trust, T-A (R7): restoring retained receipts also preserves access to their
 * raw evidence. Two changed same-day runs and an unchanged recheck are archived with the
 * real raw tooling into a local store, restored into a new directory, and every run's
 * locator must still resolve to files that rehash to its checksum.
 */
const secret = 'synthetic-local-fixture-'.repeat(2);
let handle: DbHandle;
const temp: string[] = [];
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(async () => {
  await handle.close();
  for (const path of temp.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('raw archive and restore keep evidence access (R7)', () => {
  it('every retained run locator is readable after a restore and rehashes to its checksum', async () => {
    const id = 'congress-legislators';
    const server = await evidenceServer(id);
    const rt = await testRuntime(handle, { http: server.deps });
    temp.push(rt.rawRoot);
    const input = { source: id, scope: SCOPES[id] } as const;
    const first = (await runIngest(input, rt)) as IngestRunReceipt;
    const body = server.files.get('legislators-current.json');
    if (!body) throw new Error('fixture missing');
    server.files.set('legislators-current.json', renamedLegislators(body, 'Evidence Restore'));
    const second = (await runIngest(input, rt)) as IngestRunReceipt;
    const recheck = (await runIngest(input, rt)) as IngestRunReceipt;
    expect([first.status, second.status, recheck.deduplicated]).toEqual([
      'succeeded',
      'succeeded',
      true,
    ]);

    const work = await mkdtemp(join(tmpdir(), 'civic-evidence-restore-'));
    temp.push(work);
    const store = await createStore({ BACKUP_LOCAL_DIR: join(work, 'archive') });
    const archive = await archiveRaw({ root: rt.rawRoot, secret, store });
    // In-flight staging is never archived; conditional-request state is.
    expect(archive.files.some((f) => f.path.split('/').includes('.staging'))).toBe(false);
    const target = join(work, 'restored');
    await restoreRaw({
      target,
      manifestKey: `raw/${archive.id}/manifest.json`,
      secret,
      store,
      execute: true,
    });
    for (const receipt of [first, second]) await expectEvidenceIntact(target, receipt);
  });
});
