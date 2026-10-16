import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** Materialized read models, refreshed in this order. */
export const READ_MODEL_VIEWS = ['person_card', 'person_card_scorecard'] as const;

/**
 * Rebuilds the Explore read models. CONCURRENTLY keeps readers on the old rows while it
 * runs. It is allowed inside a transaction block (verified on PostgreSQL 17 and PGlite),
 * and the ingest runtime calls it inside the load transaction, so the facts, both views and
 * the success receipt commit together or not at all (DECISIONS A50).
 */
export async function refreshPersonCard(db: Db): Promise<void> {
  for (const view of READ_MODEL_VIEWS) {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY ${sql.identifier(view)}`);
  }
}
