import { isIP } from 'node:net';

export interface BucketRule {
  /** Burst size; also the starting balance of a new bucket. */
  capacity: number;
  refillPerSecond: number;
}

export type RateDecision =
  | { allowed: true; limit: number; remaining: number }
  | { allowed: false; limit: number; retryAfterSeconds: number };

/**
 * Seam for a shared store (Redis, Upstash, ...). The in-memory implementation below is per
 * process, so with N instances the effective limit is N times higher (docs/OPERATIONS.md).
 */
export interface RateLimiter {
  take(key: string, rule: BucketRule): RateDecision | Promise<RateDecision>;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  // Map iteration order is insertion order, so re-inserting on use keeps it least-recently-used.
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, rule: BucketRule): RateDecision {
    const now = this.now();
    const previous = this.buckets.get(key);
    const tokens = previous
      ? Math.min(
          rule.capacity,
          previous.tokens + ((now - previous.updatedAt) / 1000) * rule.refillPerSecond,
        )
      : rule.capacity;

    const allowed = tokens >= 1;
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, updatedAt: now });
    if (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }

    if (allowed) return { allowed: true, limit: rule.capacity, remaining: Math.floor(tokens - 1) };
    return {
      allowed: false,
      limit: rule.capacity,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / rule.refillPerSecond)),
    };
  }
}

export const UNKNOWN_CLIENT = 'unknown';

export interface ClientIpOptions {
  trustedProxyHeader: string | undefined;
  trustedProxyHops: number;
}

/**
 * Route handlers cannot see the socket address, so the client address comes only from a header
 * that the operator declares trusted. With none configured every caller shares one bucket
 * (fail closed against forged headers, at the cost of a global limit).
 */
export function clientIp(headers: Headers, options: ClientIpOptions): string {
  if (!options.trustedProxyHeader) return UNKNOWN_CLIENT;
  const raw = headers.get(options.trustedProxyHeader);
  if (!raw) return UNKNOWN_CLIENT;
  const candidate =
    options.trustedProxyHeader === 'x-forwarded-for'
      ? raw.split(',').at(-options.trustedProxyHops)
      : raw;
  const ip = candidate?.trim();
  return ip && isIP(ip) !== 0 ? ip.toLowerCase() : UNKNOWN_CLIENT;
}
