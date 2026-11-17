import { CapabilityError, type ReadOnlyAttestation } from '@civic-ledger/core';
import { describe, expect, it, vi } from 'vitest';
import {
  attestationLine,
  createWebReadOnlyGate,
  passReadOnlyGate,
  startupReadOnlyProblem,
} from '../src/server/readonly-gate';

/** T-O O1 in the web adapter: startup and first-use behaviour around the attestation gate. */
const facts = {
  superuser: false,
  createRole: false,
  createDb: false,
  ownedRelations: 3,
  writableRelations: 3,
  writableSequences: 0,
  createOnSchema: true,
  createOnDatabase: false,
  defaultReadOnly: false,
};
const REFUSED: ReadOnlyAttestation = {
  action: 'refuse',
  problems: ['owns_relations', 'writable_relations', 'create_on_schema'],
  warnings: ['default_transaction_read_only_off'],
  message: 'The read-only database login can write (owns_relations).',
  facts,
};
const ACCEPTED: ReadOnlyAttestation = {
  action: 'accept',
  problems: [],
  warnings: [],
  message: 'Read-only database login verified.',
  facts: { ...facts, ownedRelations: 0, writableRelations: 0, createOnSchema: false },
};

describe('web read-only gate', () => {
  it('startup reports a refusal (exit) but not an unreachable database', async () => {
    const lines: string[] = [];
    const refused = createWebReadOnlyGate(
      async () => REFUSED,
      (line) => lines.push(line),
    );
    expect(await startupReadOnlyProblem(refused)).toMatch(/can write/);
    const down = createWebReadOnlyGate(
      async () => ({ action: 'unverified', code: 'ECONNREFUSED' }),
      () => {},
    );
    expect(await startupReadOnlyProblem(down)).toBeNull();
    const ok = createWebReadOnlyGate(
      async () => ACCEPTED,
      () => {},
    );
    expect(await startupReadOnlyProblem(ok)).toBeNull();
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(parsed).toMatchObject({
      level: 'fatal',
      event: 'db.readonly_attestation',
      outcome: 'refuse',
      problems: ['owns_relations', 'writable_relations', 'create_on_schema'],
    });
  });

  it('a refused login serves no data: every read fails with a safe internal error', async () => {
    const attest = vi.fn(async () => REFUSED);
    const gate = createWebReadOnlyGate(attest, () => {});
    for (let i = 0; i < 3; i++) {
      const error = await passReadOnlyGate(gate).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CapabilityError);
      expect((error as CapabilityError).code).toBe('internal');
      expect((error as CapabilityError).message).toMatch(/not read-only/);
    }
    expect(attest).toHaveBeenCalledTimes(1);
  });

  it('first use after an outage at startup attests again and then opens', async () => {
    const attest = vi
      .fn<() => Promise<ReadOnlyAttestation>>()
      .mockResolvedValueOnce({ action: 'unverified', code: 'ECONNREFUSED' })
      .mockResolvedValue(ACCEPTED);
    const gate = createWebReadOnlyGate(attest, () => {});
    expect(await startupReadOnlyProblem(gate)).toBeNull();
    await expect(passReadOnlyGate(gate)).resolves.toBeUndefined();
    await expect(passReadOnlyGate(gate)).resolves.toBeUndefined();
    expect(attest).toHaveBeenCalledTimes(2);
  });

  it('log lines carry outcome and codes only', () => {
    expect(attestationLine({ action: 'skipped' })).toBeNull();
    const line = attestationLine({ action: 'unverified', code: '28P01' }) ?? '';
    expect(JSON.parse(line)).toMatchObject({ level: 'warn', outcome: 'unverified', code: '28P01' });
    expect(Object.keys(JSON.parse(attestationLine(REFUSED) ?? '{}')).sort()).toEqual([
      'event',
      'level',
      'msg',
      'outcome',
      'problems',
      'warnings',
    ]);
  });
});
