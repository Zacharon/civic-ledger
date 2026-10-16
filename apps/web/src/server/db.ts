import 'server-only';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type CapabilityContext,
  createDb,
  type DbConfig,
  type DbHandle,
  dbConfigFromEnv,
} from '@civic-ledger/core';

declare global {
  // One database handle per server process, shared with the /api/v1 adapter (same key) so
  // the UI and the API read the same state, and surviving dev-server module reloads.
  var __civicLedgerApiDb: DbHandle | undefined;
}

/**
 * `DATABASE_URL` selects Postgres. Otherwise PGlite at `PGLITE_DATA_DIR`, defaulting to the
 * repo-root `.pglite/dev` that `pnpm db:seed` fills (the Next server runs from apps/web).
 */
export function webDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const fromEnv = dbConfigFromEnv(env, { readOnly: true });
  if (fromEnv.kind === 'pg') return fromEnv;
  const dataDir = env.PGLITE_DATA_DIR?.trim();
  return { kind: 'pglite', dataDir: dataDir ? resolve(dataDir) : defaultPgliteDir() };
}

function defaultPgliteDir(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve('.pglite', 'dev');
    dir = parent;
  }
  return join(dir, '.pglite', 'dev');
}

export function webContext(): CapabilityContext {
  globalThis.__civicLedgerApiDb ??= createDb(webDbConfig());
  return { db: globalThis.__civicLedgerApiDb.db };
}
