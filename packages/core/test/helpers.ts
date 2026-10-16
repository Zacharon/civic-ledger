import { createDb, type DbHandle } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import { afterAll, beforeAll, expect } from 'vitest';
import type { CapabilityContext } from '../src/capability';
import { CapabilityError, type ErrorCode } from '../src/errors';

/** Boots an in-memory PGlite with migrations + the fictional seed for one test file. */
export function useSeededDb(): { ctx: () => CapabilityContext; handle: () => DbHandle } {
  let handle: DbHandle | undefined;
  beforeAll(async () => {
    handle = createDb({ kind: 'pglite' });
    await runMigrations(handle);
    await seedDevData(handle.db);
  });
  afterAll(() => handle?.close());
  const ready = () => {
    if (!handle) throw new Error('Database not ready');
    return handle;
  };
  return { ctx: () => ({ db: ready().db }), handle: ready };
}

export async function expectCapabilityError(
  promise: Promise<unknown>,
  code: ErrorCode,
): Promise<CapabilityError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof CapabilityError)) {
    throw new Error(`Expected CapabilityError(${code}), got ${String(error)}`);
  }
  expect(error.code).toBe(code);
  return error;
}
