import {
  type CapabilityContext,
  createDb,
  type DbHandle,
  dbConfigFromEnv,
} from '@civic-ledger/core';

declare global {
  // One database handle per server process, surviving dev-server module reloads.
  var __civicLedgerApiDb: DbHandle | undefined;
}

/** `DATABASE_URL` selects Postgres; otherwise file-backed PGlite (see `dbConfigFromEnv`). */
export function getApiContext(): CapabilityContext {
  globalThis.__civicLedgerApiDb ??= createDb(dbConfigFromEnv());
  return { db: globalThis.__civicLedgerApiDb.db };
}
