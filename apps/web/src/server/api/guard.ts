import { CapabilityError } from '@civic-ledger/core';
import type { ApiConfig, RuleName } from './config';
import { errorResponse } from './http';
import type { Logger } from './logger';
import { clientIp, type RateLimiter } from './rate-limit';
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
  return 'default';
}

export interface GuardDeps {
  limiter: RateLimiter;
  config: ApiConfig['rateLimit'];
  logger: Logger;
}

let warnedSharedBucket = false;

/**
 * Runs in `proxy.ts` ahead of every `/api/*` request: assigns the request id and applies the
 * per-client token bucket. Kept free of Next types so it can be tested with plain Requests.
 */
export function createGuard({ limiter, config, logger }: GuardDeps): Guard {
  return {
    async check(request) {
      const requestId = requestIdFrom(request.headers);
      // Preflights carry no data and are cheap; they must not eat the caller's budget.
      if (request.method === 'OPTIONS') {
        return { kind: 'pass', requestId, responseHeaders: new Headers() };
      }

      if (!config.trustedProxyHeader && !warnedSharedBucket) {
        warnedSharedBucket = true;
        logger.warn('TRUSTED_PROXY_HEADER is unset: all API callers share one rate-limit bucket');
      }
      const ip = clientIp(request.headers, config);
      const rule = ruleFor(new URL(request.url).pathname);
      const decision = await limiter.take(`${rule}:${ip}`, config.rules[rule]);

      if (!decision.allowed) {
        logger.warn(
          { requestId, rule, path: new URL(request.url).pathname, status: 429 },
          'rate limited',
        );
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
