import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BATCH_POOL_DEFAULTS, dbConfigFromEnv, INTERACTIVE_POOL_DEFAULTS } from '../src/client';

const URL = 'postgres://owner:pw@db.example/civic';
const READ_URL = 'postgres://civic_web:pw@db.example/civic';

describe('dbConfigFromEnv', () => {
  it('falls back to PGlite without DATABASE_URL', () => {
    expect(dbConfigFromEnv({}).kind).toBe('pglite');
    expect(dbConfigFromEnv({ DATABASE_URL: '  ' }).kind).toBe('pglite');
  });

  it('defaults to the repo-root .pglite/dev from any package directory', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const before = process.cwd();
    try {
      process.chdir(join(root, 'apps', 'web'));
      expect(dbConfigFromEnv({})).toEqual({
        kind: 'pglite',
        dataDir: join(root, '.pglite', 'dev'),
      });
    } finally {
      process.chdir(before);
    }
  });

  it('uses interactive defaults for web and MCP, batch defaults for ingest', () => {
    expect(dbConfigFromEnv({ DATABASE_URL: URL })).toMatchObject({
      kind: 'pg',
      url: URL,
      statementTimeoutMs: INTERACTIVE_POOL_DEFAULTS.statementTimeoutMs,
      poolMax: 10,
    });
    expect(INTERACTIVE_POOL_DEFAULTS.statementTimeoutMs).toBe(15_000);
    expect(dbConfigFromEnv({ DATABASE_URL: URL }, { batch: true })).toMatchObject({
      statementTimeoutMs: BATCH_POOL_DEFAULTS.statementTimeoutMs,
      idleInTransactionTimeoutMs: BATCH_POOL_DEFAULTS.idleInTransactionTimeoutMs,
    });
    expect(BATCH_POOL_DEFAULTS.statementTimeoutMs).toBeGreaterThan(
      INTERACTIVE_POOL_DEFAULTS.statementTimeoutMs,
    );
  });

  it('every limit is configurable from the environment, and 0 disables a timeout', () => {
    const env = {
      DATABASE_URL: URL,
      DB_POOL_MAX: '3',
      DB_STATEMENT_TIMEOUT_MS: '2500',
      INGEST_DB_STATEMENT_TIMEOUT_MS: '0',
      DB_CONNECT_TIMEOUT_MS: '4000',
      DB_IDLE_TIMEOUT_MS: '5000',
      DB_LOCK_TIMEOUT_MS: '6000',
      DB_IDLE_IN_TX_TIMEOUT_MS: '7000',
    };
    expect(dbConfigFromEnv(env)).toMatchObject({
      poolMax: 3,
      statementTimeoutMs: 2500,
      connectTimeoutMs: 4000,
      idleTimeoutMs: 5000,
      lockTimeoutMs: 6000,
      idleInTransactionTimeoutMs: 7000,
    });
    expect(dbConfigFromEnv(env, { batch: true })).toMatchObject({ statementTimeoutMs: 0 });
  });

  it('treats empty values as unset and rejects nonsense loudly', () => {
    expect(dbConfigFromEnv({ DATABASE_URL: URL, DB_POOL_MAX: '' })).toMatchObject({ poolMax: 10 });
    expect(() => dbConfigFromEnv({ DATABASE_URL: URL, DB_POOL_MAX: '0' })).toThrow(/at least 1/);
    expect(() => dbConfigFromEnv({ DATABASE_URL: URL, DB_CONNECT_TIMEOUT_MS: 'soon' })).toThrow(
      /DB_CONNECT_TIMEOUT_MS must be a non-negative integer/,
    );
    expect(() => dbConfigFromEnv({ DATABASE_URL: URL, DB_LOCK_TIMEOUT_MS: '-1' })).toThrow(
      /non-negative/,
    );
  });

  it('prefers DATABASE_URL_READONLY only for read-only consumers', () => {
    const env = { DATABASE_URL: URL, DATABASE_URL_READONLY: READ_URL };
    expect(dbConfigFromEnv(env, { readOnly: true })).toMatchObject({ url: READ_URL });
    expect(dbConfigFromEnv(env, { batch: true })).toMatchObject({ url: URL });
    expect(dbConfigFromEnv(env)).toMatchObject({ url: URL });
    expect(dbConfigFromEnv({ DATABASE_URL: URL }, { readOnly: true })).toMatchObject({ url: URL });
    expect(dbConfigFromEnv({ DATABASE_URL_READONLY: READ_URL }, { readOnly: true }).kind).toBe(
      'pg',
    );
  });
});
