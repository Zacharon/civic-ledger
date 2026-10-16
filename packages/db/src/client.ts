import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import pg from 'pg';

export type DbConfig =
  | { kind: 'pglite'; dataDir?: string }
  | { kind: 'pg'; url: string; poolMax: number; statementTimeoutMs?: number };

/** Driver-neutral database type used by capabilities, seed and ingest. */
export type Db = PgDatabase<PgQueryResultHKT>;

export type DbHandle =
  | { kind: 'pglite'; db: PgliteDatabase; client: PGlite; close: () => Promise<void> }
  | { kind: 'pg'; db: NodePgDatabase; pool: pg.Pool; close: () => Promise<void> };

export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_PGLITE_DIR = '.pglite/dev';

/** PGlite without `dataDir` is in-memory (tests). PGlite is a single in-process connection. */
export function createDb(config: DbConfig): DbHandle {
  if (config.kind === 'pglite') {
    if (config.dataDir) mkdirSync(config.dataDir, { recursive: true });
    const client = config.dataDir ? new PGlite(config.dataDir) : new PGlite();
    return { kind: 'pglite', db: drizzlePglite({ client }), client, close: () => client.close() };
  }
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.poolMax,
    statement_timeout: config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  return { kind: 'pg', db: drizzlePg({ client: pool }), pool, close: () => pool.end() };
}

/** `DATABASE_URL` selects Postgres; otherwise a file-backed PGlite under the working directory. */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = env.DATABASE_URL?.trim();
  if (!url) return { kind: 'pglite', dataDir: resolve(DEFAULT_PGLITE_DIR) };
  const poolMax = Number.parseInt(env.DB_POOL_MAX ?? '', 10);
  return {
    kind: 'pg',
    url,
    poolMax: Number.isInteger(poolMax) && poolMax > 0 ? poolMax : DEFAULT_POOL_MAX,
  };
}
