import { type CapabilityContext, type CapabilityOutput, dispatch } from '@civic-ledger/core';
import { NO_STORE } from './cache';
import type { ApiConfig } from './config';
import { baseHeaders } from './http';
import type { Logger } from './logger';
import { requestIdFrom } from './request-id';

/** Roughly twice the planned schedule (ARCHITECTURE section 4); anything else uses the config default. */
const SOURCE_MAX_AGE_HOURS: Record<string, number> = {
  'congress-legislators': 48,
  'govinfo-billstatus': 48,
  'fec-bulk': 14 * 24,
  voteview: 14 * 24,
};

type SourcesStatus = CapabilityOutput<'sources.status'>;

export type Freshness = 'fresh' | 'stale' | 'never_succeeded';

export interface SourceHealth {
  id: string;
  freshness: Freshness;
  lastSuccessAt: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number;
  lastRunStatus: string | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  time: string;
  checks: {
    database: { status: 'ok' | 'down'; latencyMs: number; reason?: 'timeout' | 'unavailable' };
    ingest: { status: 'ok' | 'degraded' | 'unknown'; sources: SourceHealth[] };
  };
}

/** Pure: how fresh is each source's latest successful run, given `now`. */
export function assessSources(
  sources: SourcesStatus['sources'],
  now: Date,
  defaultMaxAgeHours: number,
): SourceHealth[] {
  return sources.map((source) => {
    const maxAgeSeconds = (SOURCE_MAX_AGE_HOURS[source.id] ?? defaultMaxAgeHours) * 3600;
    const lastSuccessAt = source.lastSuccess?.finishedAt ?? source.lastSuccess?.startedAt ?? null;
    const ageSeconds = lastSuccessAt
      ? Math.max(0, Math.round((now.getTime() - Date.parse(lastSuccessAt)) / 1000))
      : null;
    const freshness: Freshness =
      ageSeconds === null ? 'never_succeeded' : ageSeconds > maxAgeSeconds ? 'stale' : 'fresh';
    return {
      id: source.id,
      freshness,
      lastSuccessAt,
      ageSeconds,
      maxAgeSeconds,
      lastRunStatus: source.lastRun?.status ?? null,
    };
  });
}

class TimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export interface HealthDeps {
  context: () => CapabilityContext | Promise<CapabilityContext>;
  config: ApiConfig['health'];
  logger: Logger;
  now?: () => Date;
}

/**
 * Health = a real database round trip (the `sources.status` capability, so it also exercises the
 * read path adapters use) plus the age of each source's latest successful ingest run.
 * 503 only when the database is down; stale or never-run sources report `degraded` with 200 so a
 * failed upstream does not take the site out of rotation. `?strict=1` makes `degraded` a 503 too
 * (use it for the ingest-freshness alert).
 */
export function createHealthHandler({
  context,
  config,
  logger,
  now = () => new Date(),
}: HealthDeps) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFrom(request.headers);
    const strict = new URL(request.url).searchParams.get('strict') === '1';
    const started = performance.now();

    let report: HealthReport;
    try {
      const status = await withTimeout(
        Promise.resolve(context()).then((ctx) => dispatch('sources.status', {}, ctx)),
        config.dbTimeoutMs,
      );
      const latencyMs = Math.round(performance.now() - started);
      const sources = assessSources(status.sources, now(), config.maxIngestAgeHours);
      const degraded = sources.length === 0 || sources.some((s) => s.freshness !== 'fresh');
      report = {
        status: degraded ? 'degraded' : 'ok',
        time: now().toISOString(),
        checks: {
          database: { status: 'ok', latencyMs },
          ingest: {
            status: degraded ? 'degraded' : 'ok',
            sources,
          },
        },
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      logger.error(
        { requestId, err: error instanceof Error && 'cause' in error ? error.cause : error },
        'health check failed',
      );
      report = {
        status: 'down',
        time: now().toISOString(),
        checks: {
          database: {
            status: 'down',
            latencyMs,
            reason: error instanceof TimeoutError ? 'timeout' : 'unavailable',
          },
          ingest: { status: 'unknown', sources: [] },
        },
      };
    }

    const httpStatus =
      report.status === 'down' || (strict && report.status === 'degraded') ? 503 : 200;
    return new Response(JSON.stringify(report), {
      status: httpStatus,
      headers: baseHeaders(requestId, { 'cache-control': NO_STORE }),
    });
  };
}
