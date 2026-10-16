import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * Rebuilds the Explore read model. CONCURRENTLY keeps readers unblocked; it cannot
 * run inside a transaction, so call this after the load transaction commits.
 */
export async function refreshPersonCard(db: Db): Promise<void> {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY person_card`);
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY person_card_scorecard`);
}
