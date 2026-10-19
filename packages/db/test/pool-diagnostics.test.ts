import { describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/client';

describe('background pool diagnostics', () => {
  it('emits only the event and a bounded SQLSTATE, never driver messages or SQL', async () => {
    // pg.Pool is lazy: emitting this event opens no socket and uses no credentials.
    const handle = createDb({ kind: 'pg', url: 'postgres://unused.invalid/fictional', poolMax: 1 });
    if (handle.kind !== 'pg') throw new Error('expected pool');
    const lines: string[] = [];
    const sink = vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
      lines.push(String(value));
      return true;
    });
    try {
      const marker = 'fictional-pool-diagnostic-canary';
      const error = Object.assign(new Error(marker), { code: '42P01', query: marker });
      handle.pool.emit('error', error);
      expect(lines.join('')).not.toContain(marker);
      expect(JSON.parse(lines[0] ?? '{}')).toEqual({
        level: 'error',
        msg: 'database pool error',
        code: '42P01',
      });
    } finally {
      sink.mockRestore();
      await handle.close();
    }
  });

  it('does not execute error getters or let a broken diagnostic sink crash the caller', async () => {
    const handle = createDb({ kind: 'pg', url: 'postgres://unused.invalid/fictional', poolMax: 1 });
    if (handle.kind !== 'pg') throw new Error('expected pool');
    const getter = vi.fn(() => {
      throw new Error('diagnostic getter must not execute');
    });
    const error = Object.defineProperties(new Error(), {
      message: { get: getter },
      code: { get: getter },
    });
    const sink = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('fictional sink failure');
    });
    try {
      expect(() => handle.pool.emit('error', error)).not.toThrow();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      sink.mockRestore();
      await handle.close();
    }
  });
});
