import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestFixture, testRuntime } from '../packages/ingest/test/helpers';
import { CRASH_EXIT_CODE, runCrashChild } from '../packages/ingest/test/support/crash';
import { publicationScenarios } from '../packages/ingest/test/support/publication-scenarios';
import { type MigratedDatabase, migratedDatabase, rows } from './helpers';

/** H3-01 on real Postgres: the same scenarios as the PGlite suite, plus a killed process. */
let db: MigratedDatabase;
beforeEach(async () => {
  db = await migratedDatabase();
});
afterEach(() => db.cleanup());

describe('publication boundary (Postgres)', () => {
  publicationScenarios(() => db.handle);

  it('a process that dies after loading leaves no committed facts and an abandoned receipt', async () => {
    expect(await runCrashChild(db.database.url)).toBe(CRASH_EXIT_CODE);
    const [state] = await rows<{ people: number; running: number }>(
      db.handle,
      sql`select (select count(*) from person)::int as people,
        (select count(*) from ingest_run where status = 'running')::int as running`,
    );
    expect(state).toEqual({ people: 0, running: 1 });
    const next = await ingestFixture(await testRuntime(db.handle), 'congress-legislators');
    expect(next.status).toBe('succeeded');
    const [abandoned] = await rows<{ status: string; error: string }>(
      db.handle,
      sql`select status::text as status, error from ingest_run where id <> ${next.runId}`,
    );
    expect(abandoned).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/^abandoned/),
    });
  });
});
