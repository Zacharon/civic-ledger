/** Test-only states absent from the general dev seed: never loaded, failed after success,
 * a run with unit-bearing counts, and an earlier academic score with different values. */
import { createDb, refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';

const handle = createDb({ kind: 'pg', url: process.argv[2] ?? '', poolMax: 1 });
try {
  await handle.db.execute(sql`
    insert into source (id, name, url, license, description) values
      ('parity-pending', 'Fictional source awaiting a load', 'https://example.org/parity/pending', 'Fictional test data', 'No run exists for this test source.'),
      ('parity-failed', 'Fictional source with a failed load', 'https://example.org/parity/failed', 'Fictional test data', 'A failed latest run preserves the earlier successful load.');
    insert into ingest_run (source_id, adapter_version, scope, status, started_at, finished_at, counts) values
      ('parity-failed', 'parity@1', 'all', 'succeeded', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', '{"people":3}');
    insert into ingest_run (source_id, adapter_version, scope, status, started_at, finished_at, counts, error) values
      ('parity-failed', 'parity@2', 'all', 'failed', '2026-01-02T00:00:00Z', '2026-01-02T00:00:01Z', '{"people":7,"contribution_cents_total":1234500,"industry_coverage_bps":4321}', 'Fictional fixture load refused; previous publication retained.');
    insert into ideology_score (person_id, congress, method, dim1, dim2, source_id, source_key, ingest_run_id, retrieved_at)
      select id, 118, 'dw-nominate', 0.173, -0.287, source_id, 'parity:earlier-score', ingest_run_id, retrieved_at
      from person where slug = 'avery-ashvale';
    delete from committee_contribution where person_id = (select id from person where slug = 'blair-brindlemoor');
    insert into person_identifier (person_id, scheme, value, source_id, source_key, ingest_run_id, retrieved_at)
      select id, 'bioguide', 'X000001', source_id, 'parity:curated-alias', ingest_run_id, retrieved_at
      from person where slug = 'avery-ashvale';
  `);
  await refreshPersonCard(handle.db);
} finally {
  await handle.close();
}
