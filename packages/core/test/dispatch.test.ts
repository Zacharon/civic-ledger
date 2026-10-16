import { createDb } from '@civic-ledger/db';
import { runMigrations } from '@civic-ledger/db/migrate';
import { describe, expect, it } from 'vitest';
import { isCapabilityName, publicCapabilities, registry } from '../src/capabilities/registry';
import { dispatch, dispatchByName } from '../src/dispatch';
import { ErrorBodySchema, HTTP_STATUS_BY_ERROR } from '../src/errors';
import { expectCapabilityError, useSeededDb } from './helpers';

describe('registry', () => {
  it('keys every capability by its own name', () => {
    for (const [key, capability] of Object.entries(registry)) {
      expect(capability.name).toBe(key);
      expect(capability.version).toBe(1);
    }
  });

  it('exposes only public reads to adapters (no write or operator capability)', () => {
    const exposed = publicCapabilities();
    expect(exposed.map((c) => c.name).sort()).toEqual([
      'explore.table',
      'frameworks.evaluate',
      'frameworks.list',
      'money.summary',
      'people.compare',
      'people.get',
      'people.search',
      'policy.areas',
      'promises.list',
      'scores.list',
      'sources.status',
      'votes.list',
    ]);
    expect(exposed.every((c) => c.kind === 'read')).toBe(true);
    expect(isCapabilityName('ingest.run')).toBe(false);
  });
});

describe('dispatch', () => {
  const db = useSeededDb();

  it('rejects unknown capability names with not_found', async () => {
    await expectCapabilityError(dispatchByName('people.delete', {}, db.ctx()), 'not_found');
  });

  it('rejects unknown input keys with invalid_input and dotted issue paths', async () => {
    const error = await expectCapabilityError(
      dispatch('people.search', { limt: 5, chamber: 'lords' }, db.ctx()),
      'invalid_input',
    );
    expect(error.issues?.map((i) => i.path).sort()).toEqual(['', 'chamber']);
    expect(ErrorBodySchema.parse(error.toBody()).error.code).toBe('invalid_input');
    expect(HTTP_STATUS_BY_ERROR[error.code]).toBe(400);
  });

  it('applies input defaults', async () => {
    const result = await dispatch('people.search', {}, db.ctx());
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('wraps unexpected handler failures as internal without leaking details', async () => {
    const broken = createDb({ kind: 'pglite' });
    await runMigrations(broken);
    await broken.close();
    const error = await expectCapabilityError(
      dispatch('policy.areas', {}, { db: broken.db }),
      'internal',
    );
    expect(error.toBody()).toEqual({ error: { code: 'internal', message: 'policy.areas failed' } });
    expect(error.cause).toBeDefined();
  });
});
