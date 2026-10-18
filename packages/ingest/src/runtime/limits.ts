import type { IngestLimits } from '../adapter';

/**
 * Raw-input byte caps (DECISIONS A53). Defaults sit far above the largest 2026 files
 * (BILLSTATUS zips 54 MB in total, FEC pas2 tens of MB). They are an unmeasured agent
 * proposal, not a sizing result: no host has been selected and no total disk/memory use
 * was measured against one, so they await owner/host sizing (A53, D1). A breach fails the
 * run with a receipt.
 */
export const DEFAULT_LIMITS: IngestLimits = {
  maxDownloadBytes: 1024 ** 3,
  maxDecompressedBytes: 2 * 1024 ** 3,
};

function bytesFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of bytes, got "${raw}"`);
  }
  return value;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): IngestLimits {
  return {
    maxDownloadBytes: bytesFromEnv(
      env,
      'INGEST_MAX_DOWNLOAD_BYTES',
      DEFAULT_LIMITS.maxDownloadBytes,
    ),
    maxDecompressedBytes: bytesFromEnv(
      env,
      'INGEST_MAX_DECOMPRESSED_BYTES',
      DEFAULT_LIMITS.maxDecompressedBytes,
    ),
  };
}

/** Optional whole-run deadline in milliseconds (`INGEST_RUN_DEADLINE_MS`); unset = none. */
export function deadlineFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.INGEST_RUN_DEADLINE_MS?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`INGEST_RUN_DEADLINE_MS must be a positive integer, got "${raw}"`);
  }
  return value;
}
