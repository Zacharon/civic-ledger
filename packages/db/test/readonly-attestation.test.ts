import { describe, expect, it, vi } from 'vitest';
import {
  assessReadOnlySession,
  attestReadOnlyCredentials,
  createReadOnlyGate,
  type ReadOnlyAttestation,
  ReadOnlyCredentialsError,
  type ReadOnlySessionFacts,
  readOnlyVerdict,
} from '../src/readonly-attestation';

/** T-O O1: the decision over a session's real privileges, without a database. */
const SELECT_ONLY: ReadOnlySessionFacts = {
  superuser: false,
  createRole: false,
  createDb: false,
  ownedRelations: 0,
  writableRelations: 0,
  writableSequences: 0,
  createOnSchema: false,
  createOnDatabase: false,
  defaultReadOnly: true,
};

const OWNER: ReadOnlySessionFacts = {
  ...SELECT_ONLY,
  ownedRelations: 32,
  writableRelations: 30,
  writableSequences: 4,
  createOnSchema: true,
  defaultReadOnly: false,
};

const PRODUCTION = { NODE_ENV: 'production' };

describe('assessReadOnlySession', () => {
  it('accepts a select-only login with default_transaction_read_only on', () => {
    expect(assessReadOnlySession(SELECT_ONLY)).toEqual({ problems: [], warnings: [] });
  });

  it('names every write path of an owner session', () => {
    expect(assessReadOnlySession(OWNER)).toEqual({
      problems: ['owns_relations', 'writable_relations', 'writable_sequences', 'create_on_schema'],
      warnings: ['default_transaction_read_only_off'],
    });
  });

  it('treats role-level escalation as a problem on its own', () => {
    for (const [field, problem] of [
      ['superuser', 'superuser'],
      ['createRole', 'create_role'],
      ['createDb', 'create_db'],
      ['createOnDatabase', 'create_on_database'],
    ] as const) {
      expect(assessReadOnlySession({ ...SELECT_ONLY, [field]: true }).problems).toEqual([problem]);
    }
  });

  it('only warns when the login lacks default_transaction_read_only (A44 "should")', () => {
    expect(assessReadOnlySession({ ...SELECT_ONLY, defaultReadOnly: false })).toEqual({
      problems: [],
      warnings: ['default_transaction_read_only_off'],
    });
  });
});

describe('readOnlyVerdict', () => {
  it('refuses a writable session in production, with no URL or role name in the message', () => {
    const verdict = readOnlyVerdict(OWNER, PRODUCTION);
    expect(verdict.action).toBe('refuse');
    expect(verdict.message).toMatch(/DATABASE_URL_READONLY/);
    expect(verdict.message).toMatch(/DB_ALLOW_OWNER_CREDENTIALS=1/);
    expect(verdict.message).not.toMatch(/postgres:\/\//);
  });

  it('warns instead when production acknowledged owner credentials, and in development', () => {
    expect(readOnlyVerdict(OWNER, { ...PRODUCTION, DB_ALLOW_OWNER_CREDENTIALS: '1' }).action).toBe(
      'warn',
    );
    expect(readOnlyVerdict(OWNER, {}).action).toBe('warn');
    expect(readOnlyVerdict(OWNER, { NODE_ENV: 'test' }).action).toBe('warn');
  });

  it('accepts select-only, and only warns about the missing session default in production', () => {
    expect(readOnlyVerdict(SELECT_ONLY, PRODUCTION).action).toBe('accept');
    expect(readOnlyVerdict({ ...SELECT_ONLY, defaultReadOnly: false }, PRODUCTION).action).toBe(
      'warn',
    );
  });
});

describe('attestReadOnlyCredentials', () => {
  it('skips PGlite (single local file, no roles)', async () => {
    await expect(attestReadOnlyCredentials({ kind: 'pglite' }, PRODUCTION)).resolves.toEqual({
      action: 'skipped',
    });
  });

  it('reports an unreachable database as unverified with no URL or password', async () => {
    const result = await attestReadOnlyCredentials(
      {
        kind: 'pg',
        url: 'postgres://owner:owner-secret@127.0.0.1:1/civic',
        poolMax: 1,
        connectTimeoutMs: 2_000,
      },
      PRODUCTION,
    );
    expect(result.action).toBe('unverified');
    expect(JSON.stringify(result)).not.toContain('owner-secret');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });
});

describe('createReadOnlyGate', () => {
  const verdict = (
    facts: ReadOnlySessionFacts,
    env: Record<string, string> = PRODUCTION,
  ): ReadOnlyAttestation => ({
    ...readOnlyVerdict(facts, env),
    facts,
  });

  it('attests once, shares the in-flight check, and reports the outcome once', async () => {
    const attest = vi.fn(async () => verdict(SELECT_ONLY));
    const report = vi.fn();
    const gate = createReadOnlyGate(attest, report);
    await Promise.all([gate(), gate(), gate()]);
    await gate();
    expect(attest).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toMatchObject({ action: 'accept' });
  });

  it('a refusal is permanent: every later use fails without asking the database again', async () => {
    const attest = vi.fn(async () => verdict(OWNER));
    const gate = createReadOnlyGate(attest, () => {});
    await expect(gate()).rejects.toBeInstanceOf(ReadOnlyCredentialsError);
    await expect(gate()).rejects.toBeInstanceOf(ReadOnlyCredentialsError);
    expect(attest).toHaveBeenCalledTimes(1);
  });

  it('an unverified attempt fails that use but is retried on the next', async () => {
    const attest = vi
      .fn<() => Promise<ReadOnlyAttestation>>()
      .mockResolvedValueOnce({ action: 'unverified', code: 'ECONNREFUSED' })
      .mockResolvedValueOnce(verdict(SELECT_ONLY));
    const gate = createReadOnlyGate(attest, () => {});
    await expect(gate()).rejects.toThrow(/could not be verified/);
    await expect(gate()).resolves.toBeUndefined();
    expect(attest).toHaveBeenCalledTimes(2);
  });

  it('with blockUnverified: false (development) an unverified check lets reads through', async () => {
    const attest = vi
      .fn<() => Promise<ReadOnlyAttestation>>()
      .mockResolvedValueOnce({ action: 'unverified', code: '42809' })
      .mockResolvedValueOnce(verdict(OWNER, {}));
    const gate = createReadOnlyGate(attest, () => {}, { blockUnverified: false });
    await expect(gate()).resolves.toBeUndefined();
    await expect(gate()).resolves.toBeUndefined();
    await gate();
    expect(attest).toHaveBeenCalledTimes(2);
  });

  it('a warning lets the process run', async () => {
    const gate = createReadOnlyGate(
      async () => verdict(OWNER, {}),
      () => {},
    );
    await expect(gate()).resolves.toBeUndefined();
  });

  it('a throwing reporter cannot change the decision', async () => {
    const boom = () => {
      throw new Error('sink');
    };
    await expect(createReadOnlyGate(async () => verdict(SELECT_ONLY), boom)()).resolves.toBe(
      undefined,
    );
    await expect(createReadOnlyGate(async () => verdict(OWNER), boom)()).rejects.toBeInstanceOf(
      ReadOnlyCredentialsError,
    );
  });
});
