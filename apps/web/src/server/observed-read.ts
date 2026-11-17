import { CapabilityError, type CapabilityName } from '@civic-ledger/core';
import type { Logger } from './api/logger';
import { logSafely, safeErrorFields } from './api/logger';

export function readTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const value = env.WEB_READ_TIMEOUT_MS === undefined ? 20_000 : Number(env.WEB_READ_TIMEOUT_MS);
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error('WEB_READ_TIMEOUT_MS must be an integer from 1 to 120000');
  }
  return value;
}

const TIMED_OUT = 'The data request took too long. Try again.';

/**
 * The page reads of one request. Once any of them misses its response deadline the budget
 * expires: that response is failing anyway, so the request starts no further capability work
 * (each later read is refused before its operation runs). Work already running is not cut off
 * (the pg pool offers no per-query cancel through drizzle; `DB_STATEMENT_TIMEOUT_MS` bounds
 * each statement server-side) but it is tracked until it settles, so it drains instead of
 * leaking, and its late result or failure is absorbed.
 */
export interface ReadBudget {
  readonly signal: AbortSignal;
  /** Operations started for this request that have not settled yet. */
  readonly inFlight: number;
  expire(): void;
  /** Counts `work` until it settles; never rejects. */
  track(work: Promise<unknown>): void;
  /** Resolves when nothing tracked is still running. */
  drained(): Promise<void>;
}

export function createReadBudget(): ReadBudget {
  const controller = new AbortController();
  let inFlight = 0;
  let waiters: Array<() => void> = [];
  const settleOne = () => {
    inFlight -= 1;
    if (inFlight === 0) {
      const ready = waiters;
      waiters = [];
      for (const wake of ready) wake();
    }
  };
  return {
    signal: controller.signal,
    get inFlight() {
      return inFlight;
    },
    expire: () => controller.abort(),
    track(work) {
      inFlight += 1;
      work.then(settleOne, settleOne);
    },
    drained: () =>
      inFlight === 0 ? Promise.resolve() : new Promise<void>((wake) => void waiters.push(wake)),
  };
}

/**
 * A response deadline, not query cancellation: the database statement budget still applies.
 * With a `budget` (one per request), an expired request refuses new reads with the same
 * timeout error, and a read that times out expires the budget.
 */
export async function observedRead<T>(
  name: CapabilityName,
  requestId: string,
  operation: () => Promise<T>,
  logger: Logger,
  timeoutMs = readTimeoutMs(),
  budget?: ReadBudget,
): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome = 'succeeded';
  let diagnostic: ReturnType<typeof safeErrorFields> | undefined;
  try {
    if (budget?.signal.aborted) {
      outcome = 'skipped_expired';
      throw new CapabilityError('internal', TIMED_OUT);
    }
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        outcome = 'timed_out';
        budget?.expire();
        reject(new CapabilityError('internal', TIMED_OUT));
      }, timeoutMs);
    });
    const work = Promise.resolve().then(operation);
    budget?.track(work);
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (outcome === 'succeeded') outcome = 'failed';
    diagnostic = safeErrorFields(error instanceof CapabilityError ? (error.cause ?? error) : error);
    // Prevent framework exception logging from serializing a driver error's URL/SQL.
    if (error instanceof CapabilityError) {
      throw new CapabilityError(error.code, error.message, {
        issues: error.issues,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    throw new CapabilityError('internal', 'The data request could not be completed. Try again.');
  } finally {
    clearTimeout(timer);
    const fields = {
      event: 'web.capability',
      requestId,
      capability: name,
      outcome,
      durationMs: Math.round(performance.now() - started),
      ...(diagnostic ? { err: diagnostic } : {}),
    };
    // A broken log sink must not change a read result or leak its input as fallback.
    logSafely(() => {
      if (outcome === 'succeeded') logger.info(fields, 'page read');
      else logger.error(fields, 'page read failed');
    });
  }
}
