import { CapabilityError } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/server/api/logger';
import { observedRead, readTimeoutMs } from '../src/server/observed-read';

describe('page capability supervision', () => {
  it('correlates success and safely sanitizes a failed read without logging input', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line) => void lines.push(line) },
    });
    await expect(
      observedRead('policy.areas', 'page-request-123', async () => 42, logger),
    ).resolves.toBe(42);
    await expect(
      observedRead(
        'policy.areas',
        'page-request-123',
        async () => {
          throw new Error('SYNTHETIC_SSR_SECRET_119');
        },
        logger,
      ),
    ).rejects.toMatchObject({ code: 'internal', cause: undefined });
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.outcome)).toEqual(['succeeded', 'failed']);
    expect(entries.every((entry) => entry.requestId === 'page-request-123')).toBe(true);
    expect(lines.join('')).not.toContain('SYNTHETIC_SSR_SECRET_119');
  });

  it('ends a stalled read and does not let a broken log sink change the result', async () => {
    const logger = createLogger({
      level: 'info',
      destination: {
        write() {
          throw new Error('sink unavailable');
        },
      },
    });
    await expect(
      observedRead('policy.areas', 'page-request-456', async () => 7, logger),
    ).resolves.toBe(7);
    await expect(
      observedRead('policy.areas', 'page-request-456', () => new Promise(() => {}), logger, 20),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(() => readTimeoutMs({ WEB_READ_TIMEOUT_MS: '0' })).toThrow();
  });
});
