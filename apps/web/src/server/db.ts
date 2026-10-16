import 'server-only';
import { type CapabilityContext, createDb, type DbHandle } from '@civic-ledger/core';
import { webDbConfig } from './db-config';

declare global {
  // One database handle per server process, shared with the /api/v1 adapter (same key) so
  // the UI and the API read the same state, and surviving dev-server module reloads.
  var __civicLedgerApiDb: DbHandle | undefined;
}

export function webContext(): CapabilityContext {
  globalThis.__civicLedgerApiDb ??= createDb(webDbConfig());
  return { db: globalThis.__civicLedgerApiDb.db };
}
