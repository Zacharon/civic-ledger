/**
 * Test fixture only: adds N fictional House members (no money, votes or scores, so
 * every metric is "No data") to an e2e PGlite, to measure Explore at real scale.
 * Usage: tsx e2e/support/scale-db.ts <pgliteDir> <count>
 */
import { createDb } from '@civic-ledger/core';

const [dataDir, countText] = process.argv.slice(2);
const count = Number(countText);
if (!dataDir || !Number.isInteger(count) || count < 1) {
  throw new Error('Usage: scale-db.ts <pgliteDir> <count>');
}

const handle = createDb({ kind: 'pglite', dataDir });
if (handle.kind !== 'pglite') throw new Error('scale-db only runs against PGlite');
const last = count - 1;
const run = `(select id from ingest_run where source_id = 'dev-seed' order by id limit 1)`;
try {
  await handle.client.exec(`
    insert into office (level, chamber, state, district)
      select 'federal', 'house', 'Q' || chr(65 + (g % 26)), (g / 26) + 1
      from generate_series(0, ${last}) g
      on conflict do nothing;
    insert into person (slug, full_name, first_name, last_name, source_id, source_key, ingest_run_id, retrieved_at)
      select 'scale-member-' || g,
        case when g % 50 = 0 then 'Maximiliana Wolfenden-Abernathy-Castellanos ' || g else 'Scale Member ' || g end,
        'Scale', 'Member ' || lpad(g::text, 4, '0'),
        'dev-seed', 'scale:' || g, ${run}, now()
      from generate_series(0, ${last}) g
      on conflict do nothing;
    insert into term (person_id, office_id, party, start_date, source_id, source_key, ingest_run_id, retrieved_at)
      select p.id, o.id, case when g % 2 = 0 then 'Harbor Party' else 'Prairie Party' end,
        date '2025-01-03', 'dev-seed', 'scale-term:' || g, ${run}, now()
      from generate_series(0, ${last}) g
      join person p on p.slug = 'scale-member-' || g
      join office o on o.level = 'federal' and o.chamber = 'house'
        and o.state = 'Q' || chr(65 + (g % 26)) and o.district = (g / 26) + 1
      on conflict do nothing;
    refresh materialized view person_card;
    refresh materialized view person_card_scorecard;
  `);
  const result = await handle.client.query<{ n: number }>(
    'select count(*)::int as n from person_card',
  );
  console.log(`Scaled e2e database to ${result.rows[0]?.n} people.`);
} finally {
  await handle.close();
}
