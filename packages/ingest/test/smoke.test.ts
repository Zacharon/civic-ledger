import { createDb, type DbHandle } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRealSmoke } from '../src/smoke/real';
import { SmokeRecorder } from '../src/smoke/recorder';

// `pnpm smoke:real` targets a real database; here it runs over the fictional seed so the
// runner itself is covered in CI.
let handle: DbHandle;
beforeAll(async () => {
  handle = createDb({ kind: 'pglite' });
  await runMigrations(handle);
  await seedDevData(handle.db);
}, 60_000);
afterAll(() => handle?.close());

describe('smoke:real runner', () => {
  it('dispatches every public read and reports zero failures on the seed', async () => {
    const report = await runRealSmoke({ db: handle.db }, { formerSample: 3 });
    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({ ok: true, currentMembers: 40, formerMembersSampled: 3 });
    expect(Object.keys(report.byCapability).sort()).toEqual([
      'explore.facets',
      'explore.table',
      'frameworks.evaluate',
      'frameworks.list',
      'money.summary',
      'people.compare',
      'people.get',
      'people.search',
      'policy.areas',
      'promises.list',
      'scores.list',
      'sources.status',
      'votes.list',
    ]);
    expect(report.byCapability['people.get']?.calls).toBe(43);
  }, 120_000);

  it('records a capability error instead of stopping', async () => {
    const recorder = new SmokeRecorder({ db: handle.db });
    expect(await recorder.call('people.get', { slug: 'nobody-here' }, 'missing')).toBeNull();
    expect(await recorder.call('policy.areas', {}, 'still runs')).not.toBeNull();
    expect(recorder.failures).toMatchObject([{ capability: 'people.get', code: 'not_found' }]);
    expect(recorder.calls).toBe(2);
  });
});
