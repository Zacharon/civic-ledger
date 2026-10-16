import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type DbConfig, dbConfigFromEnv } from '@civic-ledger/core';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `DATABASE_URL_READONLY` selects Postgres (in development `DATABASE_URL` too). Otherwise
 * PGlite at `PGLITE_DATA_DIR`, defaulting to the repo-root `.pglite/dev` that
 * `pnpm db:seed` fills (the Next server runs from apps/web). Throws on a production
 * configuration without a read-only role, unless acknowledged (see packages/db client).
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

function defaultPgliteDir(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve('.pglite', 'dev');
    dir = parent;
  }
  return join(dir, '.pglite', 'dev');
}
