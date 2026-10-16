import { describe, expect, it } from 'vitest';
import { dbConfigFromEnv, OWNER_CREDENTIALS_ACK } from '../src/client';

const OWNER_URL = 'postgres://owner:owner-secret@db.example/civic';
const READ_URL = 'postgres://civic_web:web-secret@db.example/civic';
const PRODUCTION = { NODE_ENV: 'production' };

/** VC-068: production web and MCP never fall back to the owner credentials silently. */
describe('read-only consumers in production', () => {
  it('use DATABASE_URL_READONLY when it is set', () => {
    const env = { ...PRODUCTION, DATABASE_URL: OWNER_URL, DATABASE_URL_READONLY: READ_URL };
    expect(dbConfigFromEnv(env, { readOnly: true })).toMatchObject({ kind: 'pg', url: READ_URL });
  });

  it('refuse to fall back to DATABASE_URL, naming the fix and never the URL', () => {
    const env = { ...PRODUCTION, DATABASE_URL: OWNER_URL };
    let message = '';
    try {
      dbConfigFromEnv(env, { readOnly: true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/DATABASE_URL_READONLY is not set/);
    expect(message).toContain(`${OWNER_CREDENTIALS_ACK}=1`);
    expect(message).not.toContain('owner-secret');
    expect(message).not.toContain('db.example');
  });

  it('refuse a local PGlite too (it has no roles at all)', () => {
    expect(() => dbConfigFromEnv(PRODUCTION, { readOnly: true })).toThrow(
      /a local PGlite directory anyway, set DB_ALLOW_OWNER_CREDENTIALS=1/,
    );
  });

  it('fall back only with the explicit acknowledgement', () => {
    const ack = { ...PRODUCTION, [OWNER_CREDENTIALS_ACK]: '1' };
    expect(dbConfigFromEnv({ ...ack, DATABASE_URL: OWNER_URL }, { readOnly: true })).toMatchObject({
      kind: 'pg',
      url: OWNER_URL,
    });
    expect(dbConfigFromEnv(ack, { readOnly: true }).kind).toBe('pglite');
    for (const value of ['0', 'true', 'yes', '']) {
      expect(() =>
        dbConfigFromEnv(
          { ...PRODUCTION, DATABASE_URL: OWNER_URL, [OWNER_CREDENTIALS_ACK]: value },
          { readOnly: true },
        ),
      ).toThrow(/DATABASE_URL_READONLY/);
    }
  });

  it('leave development ergonomic and writers (ingest, migrate, seed) unaffected', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(
        dbConfigFromEnv({ NODE_ENV, DATABASE_URL: OWNER_URL }, { readOnly: true }),
      ).toMatchObject({ url: OWNER_URL });
      expect(dbConfigFromEnv({ NODE_ENV }, { readOnly: true }).kind).toBe('pglite');
    }
    expect(
      dbConfigFromEnv({ ...PRODUCTION, DATABASE_URL: OWNER_URL }, { batch: true }),
    ).toMatchObject({ url: OWNER_URL });
    expect(dbConfigFromEnv({ ...PRODUCTION, DATABASE_URL: OWNER_URL })).toMatchObject({
      url: OWNER_URL,
    });
  });
});
