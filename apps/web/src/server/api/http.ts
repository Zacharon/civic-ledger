import { CapabilityError, type ErrorBody, HTTP_STATUS_BY_ERROR } from '@civic-ledger/core';
import { NO_STORE } from './cache';
import { REQUEST_ID_HEADER } from './request-id';

/** Public, credential-free API: any origin may read it. */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': `${REQUEST_ID_HEADER}, etag, retry-after, ratelimit-limit, ratelimit-remaining`,
};

export const CORS_PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS',
  'access-control-allow-headers': `content-type, if-none-match, ${REQUEST_ID_HEADER}`,
  'access-control-max-age': '86400',
};

export function baseHeaders(requestId: string, extra: HeadersInit = {}): Headers {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    [REQUEST_ID_HEADER]: requestId,
    ...CORS_HEADERS,
  });
  for (const [name, value] of new Headers(extra)) headers.set(name, value);
  return headers;
}

/** Anything that is not a CapabilityError is reported as a bare `internal`. */
export function toCapabilityError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  return new CapabilityError('internal', 'Internal error', { cause: error });
}

export function errorResponse(
  error: CapabilityError,
  requestId: string,
  extra: HeadersInit = {},
  /** For HTTP-only statuses with no capability error code (405). */
  status: number = HTTP_STATUS_BY_ERROR[error.code],
): Response {
  const body: ErrorBody = error.toBody();
  const headers = baseHeaders(requestId, { 'cache-control': NO_STORE, ...extra });
  if (error.retryAfterSeconds) headers.set('retry-after', String(error.retryAfterSeconds));
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}
