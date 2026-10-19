import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import pg from 'pg';

/** Pool and session limits for a Postgres connection. `0` disables a timeout. */
export interface PgPoolSettings {
  poolMax: number;
  statementTimeoutMs: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}

export type DbConfig =
  | { kind: 'pglite'; dataDir?: string }
  | ({ kind: 'pg'; url: string; onError?: (error: Error) => void } & Partial<PgPoolSettings> &
      Pick<PgPoolSettings, 'poolMax'>);

/** Driver-neutral database type used by capabilities, seed and ingest. */
export type Db = PgDatabase<PgQueryResultHKT>;

export type DbHandle =
  | { kind: 'pglite'; db: PgliteDatabase; client: PGlite; close: () => Promise<void> }
  | { kind: 'pg'; db: NodePgDatabase; pool: pg.Pool; close: () => Promise<void> };

/** Interactive (web, MCP) statement budget. Batch loads use `BATCH_POOL_DEFAULTS`. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * The default PGlite directory: `.pglite/dev` at the workspace root (the nearest
 * `pnpm-workspace.yaml` above `from`), so the CLIs, run from any package directory, and
 * the Next server, run from apps/web, open the same database. Outside a workspace it is
 * `.pglite/dev` under `from`.
 */
export function defaultPgliteDir(from: string = process.cwd()): string {
  let dir = resolve(from);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(from, '.pglite', 'dev');
    dir = parent;
  }
  return join(dir, '.pglite', 'dev');
}

export const INTERACTIVE_POOL_DEFAULTS: PgPoolSettings = {
  poolMax: 10,
  statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 30_000,
  lockTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 60_000,
};

/**
 * Ingest runs one long transaction and large upserts, so statements may run for minutes;
 * a hung statement is still bounded instead of holding the source lock forever.
 */
export const BATCH_POOL_DEFAULTS: PgPoolSettings = {
  ...INTERACTIVE_POOL_DEFAULTS,
  statementTimeoutMs: 600_000,
  idleInTransactionTimeoutMs: 600_000,
};

/** An idle pool client can fail after a database restart; unhandled, Node would exit. */
function logPoolError(error: Error): void {
  let code: string | undefined;
  try {
    // Read a plain own value only. Driver messages/SQL and arbitrary getters must
    // never reach the diagnostic sink, including errors outside an HTTP request.
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (typeof descriptor?.value === 'string' && /^[A-Z0-9]{5}$/.test(descriptor.value)) {
      code = descriptor.value;
    }
  } catch {
    // A hostile Proxy can throw even during descriptor inspection.
  }
  try {
    process.stderr.write(
      `${JSON.stringify({ level: 'error', msg: 'database pool error', ...(code ? { code } : {}) })}\n`,
    );
  } catch {
    // Diagnostics must not turn a recoverable idle connection failure into a crash.
  }
}

/** PGlite without `dataDir` is in-memory (tests). PGlite is a single in-process connection. */
export function createDb(config: DbConfig): DbHandle {
  if (config.kind === 'pglite') {
    if (config.dataDir) mkdirSync(config.dataDir, { recursive: true });
    const client = config.dataDir ? new PGlite(config.dataDir) : new PGlite();
    return { kind: 'pglite', db: drizzlePglite({ client }), client, close: () => client.close() };
  }
  const limits = { ...INTERACTIVE_POOL_DEFAULTS, ...definedOnly(config) };
  const pool = new pg.Pool({
    connectionString: config.url,
    max: limits.poolMax,
    statement_timeout: limits.statementTimeoutMs,
    lock_timeout: limits.lockTimeoutMs,
    idle_in_transaction_session_timeout: limits.idleInTransactionTimeoutMs,
    connectionTimeoutMillis: limits.connectTimeoutMs,
    idleTimeoutMillis: limits.idleTimeoutMs,
  });
  pool.on('error', config.onError ?? logPoolError);
  return { kind: 'pg', db: drizzlePg({ client: pool }), pool, close: () => pool.end() };
}

function definedOnly(config: Partial<PgPoolSettings>): Partial<PgPoolSettings> {
  const out: Partial<PgPoolSettings> = {};
  for (const key of Object.keys(INTERACTIVE_POOL_DEFAULTS) as (keyof PgPoolSettings)[]) {
    const value = config[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Environment variables as read here; `process.env` and plain test objects both fit. */
export type EnvVars = Readonly<Record<string, string | undefined>>;

/** `=1` lets a production read-only consumer run without `DATABASE_URL_READONLY`. */
export const OWNER_CREDENTIALS_ACK = 'DB_ALLOW_OWNER_CREDENTIALS';

/**
 * A production web or MCP process must not silently fall back to the owner credentials in
 * `DATABASE_URL` (VC-068): the select-only role is the real write boundary. Development
 * (any other `NODE_ENV`) keeps the fallback. The message never contains a URL.
 */
function readOnlyUrlFrom(env: EnvVars): string | undefined {
  const url = env.DATABASE_URL_READONLY?.trim();
  if (url) return url;
  if (env.NODE_ENV === 'production' && env[OWNER_CREDENTIALS_ACK]?.trim() !== '1') {
    const fallback = env.DATABASE_URL?.trim() ? 'DATABASE_URL' : 'a local PGlite directory';
    throw new Error(
      'DATABASE_URL_READONLY is not set. In production the web app and MCP server must ' +
        'connect as a select-only role (scripts/db/roles.sql, docs/OPERATIONS.md). To run on ' +
        `${fallback} anyway, set ${OWNER_CREDENTIALS_ACK}=1.`,
    );
  }
  return undefined;
}

export interface EnvConfigOptions {
  /**
   * Use `DATABASE_URL_READONLY`. Web and MCP pass this. Outside production it falls back to
   * `DATABASE_URL`; in production that fallback needs `DB_ALLOW_OWNER_CREDENTIALS=1`.
   */
  readOnly?: boolean;
  /** Long-running loads: ingest limits and `INGEST_DB_STATEMENT_TIMEOUT_MS`. */
  batch?: boolean;
}

/** Empty or unset means "use the default"; anything else must be a non-negative integer. */
function intFromEnv(env: EnvVars, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

/**
 * `DATABASE_URL` selects Postgres; otherwise a file-backed PGlite at `defaultPgliteDir()`.
 * Limits come from `DB_*` variables (documented in docs/OPERATIONS.md).
 */
export function dbConfigFromEnv(
  env: EnvVars = process.env,
  options: EnvConfigOptions = {},
): DbConfig {
  const readOnlyUrl = options.readOnly ? readOnlyUrlFrom(env) : undefined;
  const url = readOnlyUrl || env.DATABASE_URL?.trim();
  if (!url) return { kind: 'pglite', dataDir: defaultPgliteDir() };
  const base = options.batch ? BATCH_POOL_DEFAULTS : INTERACTIVE_POOL_DEFAULTS;
  const poolMax = intFromEnv(env, 'DB_POOL_MAX', base.poolMax);
  if (poolMax < 1) throw new Error('DB_POOL_MAX must be at least 1');
  const statementVar = options.batch ? 'INGEST_DB_STATEMENT_TIMEOUT_MS' : 'DB_STATEMENT_TIMEOUT_MS';
  return {
    kind: 'pg',
    url,
    poolMax,
    statementTimeoutMs: intFromEnv(env, statementVar, base.statementTimeoutMs),
    connectTimeoutMs: intFromEnv(env, 'DB_CONNECT_TIMEOUT_MS', base.connectTimeoutMs),
    idleTimeoutMs: intFromEnv(env, 'DB_IDLE_TIMEOUT_MS', base.idleTimeoutMs),
    lockTimeoutMs: intFromEnv(env, 'DB_LOCK_TIMEOUT_MS', base.lockTimeoutMs),
    idleInTransactionTimeoutMs: intFromEnv(
      env,
      'DB_IDLE_IN_TX_TIMEOUT_MS',
      base.idleInTransactionTimeoutMs,
    ),
  };
}
