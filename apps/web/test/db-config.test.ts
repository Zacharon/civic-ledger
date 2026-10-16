import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWebDbConfig, webDbConfig } from '../src/server/db-config';

const OWNER_URL = 'postgres://owner:owner-secret@db.example/civic';
const READ_URL = 'postgres://civic_web:web-secret@db.example/civic';

/** The check `instrumentation.ts` runs before the production server accepts traffic. */
describe('web database configuration at startup', () => {
  it('refuses a production server without a read-only role', () => {
    const problem = checkWebDbConfig({ NODE_ENV: 'production', DATABASE_URL: OWNER_URL });
    expect(problem).toMatch(/DATABASE_URL_READONLY is not set/);
    expect(problem).not.toContain('owner-secret');
    expect(checkWebDbConfig({ NODE_ENV: 'production', PGLITE_DATA_DIR: 'x' })).toMatch(
      /DB_ALLOW_OWNER_CREDENTIALS=1/,
    );
  });

  it('starts on the read-only role, and reads with it', () => {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: OWNER_URL,
      DATABASE_URL_READONLY: READ_URL,
    };
    expect(checkWebDbConfig(env)).toBeNull();
    expect(webDbConfig(env)).toMatchObject({ kind: 'pg', url: READ_URL });
  });

  it('starts on PGlite in production only when acknowledged; development is unchanged', () => {
    const ack = { NODE_ENV: 'production', DB_ALLOW_OWNER_CREDENTIALS: '1', PGLITE_DATA_DIR: 'db' };
    expect(checkWebDbConfig(ack)).toBeNull();
    expect(webDbConfig(ack)).toEqual({ kind: 'pglite', dataDir: resolve('db') });
    expect(checkWebDbConfig({ NODE_ENV: 'development', DATABASE_URL: OWNER_URL })).toBeNull();
    expect(webDbConfig({ DATABASE_URL: OWNER_URL })).toMatchObject({ url: OWNER_URL });
  });
});
