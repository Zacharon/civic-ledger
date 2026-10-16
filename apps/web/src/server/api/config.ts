import type { BucketRule } from './rate-limit';

export type RuleName = 'default' | 'evaluate' | 'health';

export interface ApiConfig {
  rateLimit: {
    rules: Record<RuleName, BucketRule>;
    /** Header carrying the client address, set by a proxy we control. Unset = trust none. */
    trustedProxyHeader: string | undefined;
    /** For `x-forwarded-for`: which entry from the right is the client (1 = last proxy's view). */
    trustedProxyHops: number;
  };
  health: {
    dbTimeoutMs: number;
    /** Fallback for sources without an entry in `SOURCE_MAX_AGE_HOURS`. */
    maxIngestAgeHours: number;
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** A bucket that holds `perMinute` calls and refills at that rate. */
function perMinute(count: number): BucketRule {
  return { capacity: count, refillPerSecond: count / 60 };
}

export function loadApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  return {
    rateLimit: {
      rules: {
        default: perMinute(positiveInt(env.API_RATE_LIMIT_PER_MINUTE, 60)),
        evaluate: perMinute(positiveInt(env.API_RATE_LIMIT_EVALUATE_PER_MINUTE, 10)),
        health: perMinute(positiveInt(env.API_RATE_LIMIT_HEALTH_PER_MINUTE, 30)),
      },
      trustedProxyHeader: env.TRUSTED_PROXY_HEADER?.trim().toLowerCase() || undefined,
      trustedProxyHops: positiveInt(env.TRUSTED_PROXY_HOPS, 1),
    },
    health: {
      dbTimeoutMs: positiveInt(env.HEALTH_DB_TIMEOUT_MS, 2_000),
      maxIngestAgeHours: positiveInt(env.HEALTH_MAX_INGEST_AGE_HOURS, 14 * 24),
    },
  };
}
