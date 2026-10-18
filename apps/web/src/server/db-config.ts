import { resolve } from 'node:path';
import { type DbConfig, dbConfigFromEnv, defaultPgliteDir } from '@civic-ledger/core';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `DATABASE_URL_READONLY` selects Postgres (in development `DATABASE_URL` too). Otherwise
 * PGlite at `PGLITE_DATA_DIR`, defaulting to the repo-root `.pglite/dev` that
 * `pnpm db:seed` fills (the Next server runs from apps/web; both use `defaultPgliteDir`).
 * Throws on a production configuration without a read-only role, unless acknowledged
 * (see packages/db client).
 */
export function webDbConfig(env: Env = process.env): DbConfig {
  const fromEnv = dbConfigFromEnv(env, { readOnly: true });
  if (fromEnv.kind === 'pg') return fromEnv;
  const dataDir = env.PGLITE_DATA_DIR?.trim();
  return { kind: 'pglite', dataDir: dataDir ? resolve(dataDir) : defaultPgliteDir() };
}

/** The startup check: null when the server may start, else the reason it must not. */
export function checkWebDbConfig(env: Env): string | null {
  try {
    webDbConfig(env);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
