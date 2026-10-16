/**
 * Test fixture only: a data change as an operator would make it (owner connection), then
 * the application's own read-model refresh. Renames one person and adds to their FEC
 * totals for every cycle, so both a profile fact and a person_card metric move.
 * Usage: tsx e2e/support/change-data.ts <ownerUrl> <slug> <newName> <addCents>
 */
import { createDb, refreshPersonCard } from '@civic-ledger/db';

const [url, slug, newName, addText] = process.argv.slice(2);
const add = Number(addText);
if (!url || !slug || !newName || !Number.isInteger(add)) {
  throw new Error('Usage: change-data.ts <ownerUrl> <slug> <newName> <addCents>');
}

const handle = createDb({ kind: 'pg', url, poolMax: 1 });
if (handle.kind !== 'pg') throw new Error('change-data only runs against Postgres');
try {
  await handle.pool.query('update person set full_name = $1 where slug = $2', [newName, slug]);
  await handle.pool.query(
    `update candidate_cycle_totals set total_receipts_cents = total_receipts_cents + $1
      where person_id = (select id from person where slug = $2)`,
    [add, slug],
  );
  await refreshPersonCard(handle.db);
} finally {
  await handle.close();
}
