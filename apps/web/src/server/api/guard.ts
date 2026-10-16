import { CapabilityError } from '@civic-ledger/core';
import type { ApiConfig, RuleName } from './config';
import { errorResponse } from './http';
import type { Logger } from './logger';
import { clientIp, type RateLimiter } from './rate-limit';
import { RATE_LIMIT_IDENTITY_MESSAGE, rateLimitIdentityProblem } from './rate-limit-identity';
import { requestIdFrom } from './request-id';

export type GuardResult =
  | { kind: 'pass'; requestId: string; responseHeaders: Headers }
  | { kind: 'block'; response: Response };

export interface Guard {
  check(request: Request): Promise<GuardResult>;
}

export function ruleFor(pathname: string): RuleName {
  if (pathname === '/api/v1/frameworks.evaluate') return 'evaluate';
  if (pathname === '/api/health') return 'health';
  if (pathname.startsWith('/api/')) return 'default';
  return 'page';
}

/** Probes stay reachable when the limiter is misconfigured, so the problem can be reported. */
const ALWAYS_PASS = new Set(['/api/live', '/api/health']);

function pageLimited(requestId: string, retryAfterSeconds: number, limit: number): Response {
  return new Response(
    `Too many requests. Retry after ${retryAfterSeconds} seconds.
`,
    {
      status: 429,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(retryAfterSeconds),
        'ratelimit-limit': String(limit),
        'ratelimit-remaining': '0',
        'x-request-id': requestId,
      },
    },
  );
}

export interface GuardDeps {
  limiter: RateLimiter;
  config: ApiConfig['rateLimit'];
  logger: Logger;
}

let warnedSharedBucket = false;

/**
 * Runs in `proxy.ts` ahead of every page and `/api/*` request: assigns the request id and
 * applies the per-client token bucket. In production without a trusted client-address header
 * (and no explicit single-bucket acknowledgement) it fails closed: everything except the
 * probes gets a 503 that names the fix. Kept free of Next types so plain Requests can test it.
 */
export function createGuard({ limiter, config, logger }: GuardDeps): Guard {
  const problem = rateLimitIdentityProblem(config);
  if (problem) logger.error({ problem }, RATE_LIMIT_IDENTITY_MESSAGE);

  return {
    async check(request) {
      const requestId = requestIdFrom(request.headers);
      const pathname = new URL(request.url).pathname;
      // Preflights carry no data and are cheap; they must not eat the caller's budget.
      if (request.method === 'OPTIONS' || pathname === '/api/live') {
        return { kind: 'pass', requestId, responseHeaders: new Headers() };
      }
      if (problem && !ALWAYS_PASS.has(pathname)) {
        return {
          kind: 'block',
          response: errorResponse(
            new CapabilityError(
              'internal',
              'Service unavailable: rate limiting is not configured. The operator has been logged the fix.',
            ),
            requestId,
            { 'retry-after': '60' },
            503,
          ),
        };
      }

      if (!config.trustedProxyHeader && !warnedSharedBucket) {
        warnedSharedBucket = true;
        logger.warn('TRUSTED_PROXY_HEADER is unset: all callers share one rate-limit bucket');
      }
      const ip = clientIp(request.headers, config);
      const rule = ruleFor(pathname);
      const decision = await limiter.take(`${rule}:${ip}`, config.rules[rule]);

      if (!decision.allowed) {
        logger.warn({ requestId, rule, path: pathname, status: 429 }, 'rate limited');
        if (rule === 'page') {
          return {
            kind: 'block',
            response: pageLimited(requestId, decision.retryAfterSeconds, decision.limit),
          };
        }
        return {
          kind: 'block',
          response: errorResponse(
            new CapabilityError('rate_limited', 'Too many requests. Retry after the delay given.', {
              retryAfterSeconds: decision.retryAfterSeconds,
            }),
            requestId,
            { 'ratelimit-limit': String(decision.limit), 'ratelimit-remaining': '0' },
          ),
        };
      }
      // The route sets content type and caching; the guard adds only id and rate headers.
      const passed = new Headers({
        'x-request-id': requestId,
        'ratelimit-limit': String(decision.limit),
        'ratelimit-remaining': String(decision.remaining),
      });
      return { kind: 'pass', requestId, responseHeaders: passed };
    },
  };
}
