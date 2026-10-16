import type { ApiConfig } from './config';

/** Machine-readable reason, safe to show on the public health endpoint. */
export type RateLimitIdentityProblem = 'trusted_proxy_header_unset';

export type RateLimitMode = 'per_client' | 'single_bucket';

/**
 * Without a trusted client-address header every caller shares one bucket, so one client can
 * lock everyone out. That is acceptable in development; in production it must be an explicit
 * choice (`RATE_LIMIT_SINGLE_BUCKET=1`) or the service refuses traffic (DECISIONS A42).
 */
export function rateLimitIdentityProblem(
  config: ApiConfig['rateLimit'],
): RateLimitIdentityProblem | null {
  if (config.trustedProxyHeader) return null;
  if (!config.production || config.singleBucketAcknowledged) return null;
  return 'trusted_proxy_header_unset';
}

export function rateLimitMode(config: ApiConfig['rateLimit']): RateLimitMode {
  return config.trustedProxyHeader ? 'per_client' : 'single_bucket';
}

export const RATE_LIMIT_IDENTITY_MESSAGE =
  'TRUSTED_PROXY_HEADER is unset in production, so every caller would share one rate-limit ' +
  'bucket. Set TRUSTED_PROXY_HEADER to the header your proxy overwrites with the client ' +
  'address, or set RATE_LIMIT_SINGLE_BUCKET=1 to accept a single shared bucket. ' +
  'Requests are refused until one of the two is set.';
