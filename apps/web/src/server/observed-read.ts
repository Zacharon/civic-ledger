import { CapabilityError, type CapabilityName } from '@civic-ledger/core';
import type { Logger } from './api/logger';
import { safeErrorFields } from './api/logger';

export function readTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const value = env.WEB_READ_TIMEOUT_MS === undefined ? 20_000 : Number(env.WEB_READ_TIMEOUT_MS);
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error('WEB_READ_TIMEOUT_MS must be an integer from 1 to 120000');
  }
  return value;
}

/** A response deadline, not query cancellation: the database statement budget still applies. */
export async function observedRead<T>(
  name: CapabilityName,
  requestId: string,
  operation: () => Promise<T>,
  logger: Logger,
  timeoutMs = readTimeoutMs(),
): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome = 'succeeded';
  let diagnostic: ReturnType<typeof safeErrorFields> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        outcome = 'timed_out';
        reject(new CapabilityError('internal', 'The data request took too long. Try again.'));
      }, timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(operation), deadline]);
  } catch (error) {
    if (outcome !== 'timed_out') outcome = 'failed';
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
    try {
      if (outcome === 'succeeded') logger.info(fields, 'page read');
      else logger.error(fields, 'page read failed');
    } catch {
      // A broken log sink must not change a read result or leak its input as fallback.
    }
  }
}
