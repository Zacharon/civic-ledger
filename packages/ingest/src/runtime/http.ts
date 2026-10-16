import type { Logger } from 'pino';

/**
 * Outbound HTTP policy (ARCHITECTURE §7, VC-011/012/013): every request has an explicit
 * timeout; only transient failures (429, 5xx, network errors, timeouts) are retried, at
 * most `maxRetries` times, with exponential backoff and full jitter. Other 4xx fail fast.
 */
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Identifies the project honestly; some hosts reject non-browser agents, see `browserLike`. */
export const INGEST_USER_AGENT = 'CivicLedgerIngest/1.0 (+public-data research; operator CLI)';
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const defaultHttpDeps: HttpDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  browserLike?: boolean;
  /** Run-level cancellation, combined with the per-attempt timeout. */
  signal?: AbortSignal;
  policy?: RetryPolicy;
  logger?: Logger;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number, statusText: string) {
    super(`GET ${url} failed: HTTP ${status} ${statusText}`.trim());
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

export const isTransientStatus = (status: number): boolean => status === 429 || status >= 500;

/** Network-level failures worth retrying. Caller aborts (run cancelled) are not. */
export function isTransientError(error: unknown, callerSignal?: AbortSignal): boolean {
  if (callerSignal?.aborted) return false;
  if (error instanceof HttpError) return isTransientStatus(error.status);
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  // undici reports DNS, reset and TLS failures as `TypeError: fetch failed` with a cause.
  return error.name === 'TypeError' || 'code' in error;
}

/** Full jitter: uniform in [0, min(maxDelay, base * 2^attempt)]. */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** `Retry-After` as seconds or an HTTP date, capped by the policy's max delay. */
export function retryAfterMs(
  header: string | null,
  policy: RetryPolicy,
  now = Date.now(),
): number | null {
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, policy.maxDelayMs) : null;
}

/**
 * GET with timeout + transient-only retries. Resolves with the response once the status is
 * final (2xx, 304 or a non-retryable 4xx); the caller owns reading the body. Redirects are
 * followed (FEC bulk files 302 to S3).
 */
export async function httpGet(
  url: string,
  options: HttpRequestOptions = {},
  deps: HttpDeps = defaultHttpDeps,
): Promise<Response> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    'user-agent': options.browserLike ? BROWSER_USER_AGENT : INGEST_USER_AGENT,
    ...options.headers,
  };
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let delay: number | null = null;
    try {
      const response = await deps.fetch(url, { headers, redirect: 'follow', signal });
      if (response.ok || response.status === 304) return response;
      await response.body?.cancel();
      const error = new HttpError(url, response.status, response.statusText);
      if (!isTransientStatus(response.status) || attempt >= policy.maxRetries) throw error;
      delay = retryAfterMs(response.headers.get('retry-after'), policy);
      options.logger?.warn({ url, status: response.status, attempt }, 'transient HTTP status');
    } catch (error) {
      if (error instanceof HttpError && !isTransientStatus(error.status)) throw error;
      if (!isTransientError(error, options.signal) || attempt >= policy.maxRetries) throw error;
      options.logger?.warn({ url, attempt, err: describe(error) }, 'transient fetch error');
    }
    await deps.sleep(delay ?? backoffDelayMs(attempt, policy, deps.random));
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.name}: ${error.message}${cause}`;
}
