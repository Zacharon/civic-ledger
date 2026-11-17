import { CapabilityError } from '@civic-ledger/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/server/api/logger';
import { createReadBudget, observedRead } from '../src/server/observed-read';

/**
 * T-O O3: once one page read of a request misses its response deadline, that request starts no
 * further capability work, and work already running drains (settles, is counted out) instead of
 * leaking. Barriers are promises resolved by hand; the only clock is vitest's fake timer.
 */
const TIMEOUT_TEXT = 'The data request took too long. Try again.';

function barrier<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function recordingLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: 'info',
    destination: { write: (line) => void lines.push(JSON.parse(line)) },
  });
  return { logger, lines };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('request-scoped read budget', () => {
  it('after one read times out, the same request starts no new capability call', async () => {
    const { logger, lines } = recordingLogger();
    const budget = createReadBudget();
    const stalled = barrier<number>();
    const slow = observedRead('people.get', 'req-o3', () => stalled.promise, logger, 50, budget);
    const settledSlow = expect(slow).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(50);
    await settledSlow;
    expect(budget.signal.aborted).toBe(true);

    const later = vi.fn(async () => 1);
    await expect(
      observedRead('money.summary', 'req-o3', later, logger, 50, budget),
    ).rejects.toBeInstanceOf(CapabilityError);
    await expect(observedRead('scores.list', 'req-o3', later, logger, 50, budget)).rejects.toThrow(
      TIMEOUT_TEXT,
    );
    expect(later).not.toHaveBeenCalled();

    // A different request (its own budget) is unaffected.
    const fresh = vi.fn(async () => 2);
    await expect(
      observedRead('money.summary', 'req-other', fresh, logger, 50, createReadBudget()),
    ).resolves.toBe(2);
    expect(fresh).toHaveBeenCalledTimes(1);

    expect(lines.map((line) => [line.capability, line.outcome])).toEqual([
      ['people.get', 'timed_out'],
      ['money.summary', 'skipped_expired'],
      ['scores.list', 'skipped_expired'],
      ['money.summary', 'succeeded'],
    ]);
    stalled.resolve(0);
    await budget.drained();
  });

  it('in-flight work that outlived the deadline drains and is counted out, success or failure', async () => {
    const { logger } = recordingLogger();
    const budget = createReadBudget();
    const first = barrier<number>();
    const second = barrier<number>();
    const a = observedRead('people.get', 'req-drain', () => first.promise, logger, 50, budget);
    const b = observedRead('votes.list', 'req-drain', () => second.promise, logger, 50, budget);
    const settledA = expect(a).rejects.toThrow(TIMEOUT_TEXT);
    const settledB = expect(b).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(0);
    expect(budget.inFlight).toBe(2);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([settledA, settledB]);

    // The response is over, the operations are not: they are still counted.
    expect(budget.inFlight).toBe(2);
    let drained = false;
    const draining = budget.drained().then(() => {
      drained = true;
    });
    first.resolve(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(budget.inFlight).toBe(1);
    expect(drained).toBe(false);
    // A late failure is absorbed (no unhandled rejection) and still releases its slot.
    second.reject(new Error('late driver failure'));
    await draining;
    expect(budget.inFlight).toBe(0);
  });

  it('a sibling read already running keeps its own deadline and result', async () => {
    const { logger } = recordingLogger();
    const budget = createReadBudget();
    const stalled = barrier<number>();
    const sibling = barrier<string>();
    const slow = observedRead('people.get', 'req-sib', () => stalled.promise, logger, 50, budget);
    const settledSlow = expect(slow).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(30);
    const running = observedRead(
      'sources.status',
      'req-sib',
      () => sibling.promise,
      logger,
      50,
      budget,
    );
    await vi.advanceTimersByTimeAsync(20);
    await settledSlow;
    expect(budget.signal.aborted).toBe(true);
    sibling.resolve('ok');
    await expect(running).resolves.toBe('ok');
    stalled.resolve(0);
    await budget.drained();
    expect(budget.inFlight).toBe(0);
  });

  it('without a budget the existing per-read deadline semantics are unchanged', async () => {
    const { logger } = recordingLogger();
    const stalled = barrier<number>();
    const slow = observedRead('people.get', 'req-legacy', () => stalled.promise, logger, 50);
    const settled = expect(slow).rejects.toThrow(TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(50);
    await settled;
    const next = vi.fn(async () => 3);
    await expect(observedRead('people.get', 'req-legacy', next, logger, 50)).resolves.toBe(3);
    stalled.resolve(0);
  });
});
