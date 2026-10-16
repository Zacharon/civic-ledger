import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type DbHandle } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, ingestFixture, rows, testRuntime } from './helpers';
import { CRASH_EXIT_CODE, runCrashChild } from './support/crash';
import { publicationScenarios } from './support/publication-scenarios';

describe('publication boundary (PGlite)', () => {
  let handle: DbHandle;
  beforeEach(async () => {
    handle = await freshDb();
  });
  afterEach(() => handle.close());
  publicationScenarios(() => handle);
});

describe('process loss during publication (PGlite data directory)', () => {
  it('a process that dies after loading leaves no committed facts and an abandoned receipt', async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), 'civic-crash-pglite-')), 'db');
    const setup = createDb({ kind: 'pglite', dataDir });
    await runMigrations(setup);
    await setup.close();

    expect(await runCrashChild(dataDir)).toBe(CRASH_EXIT_CODE);

    const after = createDb({ kind: 'pglite', dataDir });
    try {
      const [state] = await rows<{ people: number; running: number }>(
        after.db,
        sql`select (select count(*) from person)::int as people,
          (select count(*) from ingest_run where status = 'running')::int as running`,
      );
      expect(state).toEqual({ people: 0, running: 1 });
      // The next run reaps the abandoned receipt and loads normally.
      const next = await ingestFixture(await testRuntime(after), 'congress-legislators');
      expect(next.status).toBe('succeeded');
      const [abandoned] = await rows<{ status: string; error: string }>(
        after.db,
        sql`select status::text as status, error from ingest_run where id <> ${next.runId}`,
      );
      expect(abandoned).toMatchObject({ status: 'failed', error: expect.stringMatching(/^abandoned/) });
    } finally {
      await after.close();
    }
  }, 120_000);
});
