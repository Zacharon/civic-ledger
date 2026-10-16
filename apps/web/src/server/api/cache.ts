import { createHash } from 'node:crypto';
import type { CapabilityName } from '@civic-ledger/core';

type CacheClass = 'reference' | 'data' | 'status' | 'none';

interface CacheTimes {
  sMaxAge: number;
  staleWhileRevalidate: number;
}

/**
 * Public data only, so shared caches are safe. Data changes only when an ingest run finishes
 * (daily at most), so even `data` tolerates minutes; `status` backs the freshness strip.
 */
const TIMES: Record<Exclude<CacheClass, 'none'>, CacheTimes> = {
  reference: { sMaxAge: 3_600, staleWhileRevalidate: 86_400 },
  data: { sMaxAge: 300, staleWhileRevalidate: 3_600 },
  status: { sMaxAge: 60, staleWhileRevalidate: 300 },
};

/** Exhaustive over public capabilities (a test enforces it); anything unlisted is `no-store`. */
export const CACHE_CLASS: Partial<Record<CapabilityName, CacheClass>> = {
  'people.search': 'data',
  'people.get': 'data',
  'people.compare': 'data',
  'explore.table': 'data',
  'money.summary': 'data',
  'votes.list': 'data',
  'scores.list': 'data',
  'promises.list': 'data',
  'policy.areas': 'reference',
  'frameworks.list': 'reference',
  'frameworks.evaluate': 'none',
  'sources.status': 'status',
};

export const NO_STORE = 'no-store';

export function cacheControlFor(capabilityName: string): string {
  const cacheClass = CACHE_CLASS[capabilityName as CapabilityName] ?? 'none';
  if (cacheClass === 'none') return NO_STORE;
  const { sMaxAge, staleWhileRevalidate } = TIMES[cacheClass];
  return `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

/** Strong validator derived from the exact bytes sent. */
export function etagOf(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
}

/** `If-None-Match` comparison (weak comparison, list and `*` aware). */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  return ifNoneMatch.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}
