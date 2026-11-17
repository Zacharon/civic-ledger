import 'server-only';
import { type CapabilityContext, createDb, type DbHandle } from '@civic-ledger/core';
import { webDbConfig } from './db-config';
import { passReadOnlyGate, webReadOnlyGate } from './readonly-gate';

declare global {
  // One database handle per server process, shared with the /api/v1 adapter (same key) so
  // the UI and the API read the same state, and surviving dev-server module reloads.
  var __civicLedgerApiDb: DbHandle | undefined;
}

/**
 * The capability context for the UI and the API. Before the first read it attests that the
 * read-only login really is read-only (DECISIONS A61); a refused login serves no data.
 */
export async function webContext(): Promise<CapabilityContext> {
  await passReadOnlyGate(webReadOnlyGate());
  globalThis.__civicLedgerApiDb ??= createDb(webDbConfig());
  return { db: globalThis.__civicLedgerApiDb.db };
}
