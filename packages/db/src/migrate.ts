import { fileURLToPath } from 'node:url';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { DbHandle } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies committed SQL migrations in order; already-applied ones are skipped. */
export async function runMigrations(handle: DbHandle): Promise<void> {
  const config = { migrationsFolder: MIGRATIONS_FOLDER };
  if (handle.kind === 'pglite') {
    await migratePglite(handle.db, config);
  } else {
    await migratePg(handle.db, config);
  }
}
