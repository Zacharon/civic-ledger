import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/server/api/config';
import { assessSources, createHealthHandler, type HealthReport } from '../src/server/api/health';
import { createLogger } from '../src/server/api/logger';
import { closedDb, ORIGIN, seededStack } from './stack';

const stack = seededStack();
const config = loadApiConfig({}).health;
const logger = createLogger({ level: 'silent' });

const call = (handler: ReturnType<typeof createHealthHandler>, query = '') =>
  handler(new Request(`${ORIGIN}/api/health${query}`));

describe('GET /api/health', () => {
  it('is ok with a DB round trip and fresh ingest, never cached', async () => {
    const handler = createHealthHandler({ context: () => stack().ctx, config, logger });
    const res = await call(handler);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const report = (await res.json()) as HealthReport;
    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(report.checks.ingest.sources.map((s) => [s.id, s.freshness])).toEqual([
      ['dev-seed', 'fresh'],
    ]);
  });

  it('degrades (200) when the latest successful run is too old, and 503s under ?strict=1', async () => {
    const future = () => new Date(Date.now() + 60 * 24 * 3600 * 1000);
    const handler = createHealthHandler({
      context: () => stack().ctx,
      config,
      logger,
      now: future,
    });
    const res = await call(handler);
    expect(res.status).toBe(200);
    const report = (await res.json()) as HealthReport;
    expect(report.status).toBe('degraded');
    expect(report.checks.ingest.sources[0]?.freshness).toBe('stale');
    expect((await call(handler, '?strict=1')).status).toBe(503);
  });

  it('is 503 and reveals no driver detail when the database is unavailable', async () => {
    const broken = await closedDb();
    const handler = createHealthHandler({ context: () => ({ db: broken.db }), config, logger });
    const res = await call(handler);
    expect(res.status).toBe(503);
    const report = (await res.json()) as HealthReport;
    expect(report.status).toBe('down');
    expect(report.checks.database).toMatchObject({ status: 'down', reason: 'unavailable' });
    expect(JSON.stringify(report)).not.toMatch(/pglite|closed|stack/i);
  });

  it('is 503 with reason "timeout" when the round trip is too slow', async () => {
    const never = new Promise<never>(() => {});
    const handler = createHealthHandler({
      context: () => never,
      config: { ...config, dbTimeoutMs: 20 },
      logger,
    });
    const res = await call(handler);
    expect(res.status).toBe(503);
    expect(((await res.json()) as HealthReport).checks.database.reason).toBe('timeout');
  });
});

describe('assessSources', () => {
  const run = (finishedAt: string | null) => ({
    id: 1,
    status: 'succeeded' as const,
    adapterVersion: 'v1',
    scope: 'cycle:2026',
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt,
    counts: {},
    error: null,
  });
  const source = (id: string, lastSuccess: ReturnType<typeof run> | null) => ({
    id,
    name: id,
    url: 'https://example.org',
    license: 'x',
    licenseUrl: null,
    description: 'x',
    lastRun: lastSuccess,
    lastSuccess,
    // sources.status freshness fields (evidence trust T-A).
    freshness: {
      lastAttemptAt: null,
      lastAttemptOutcome: null,
      lastSuccessfulCheckAt: null,
      lastChangedAt: null,
      coverageThrough: null,
      coverageBasis: null,
    },
    scopes: [],
  });

  it('applies per-source thresholds and flags sources that never succeeded', () => {
    const now = new Date('2026-10-05T00:00:00.000Z'); // 4 days after the run
    const result = assessSources(
      [
        source('congress-legislators', run('2026-10-01T00:00:00.000Z')), // 48h limit -> stale
        source('fec-bulk', run('2026-10-01T00:00:00.000Z')), // 14d limit -> fresh
        source('mystery', null),
      ],
      now,
      24 * 14,
    );
    expect(result.map((s) => [s.id, s.freshness])).toEqual([
      ['congress-legislators', 'stale'],
      ['fec-bulk', 'fresh'],
      ['mystery', 'never_succeeded'],
    ]);
    expect(result[0]?.ageSeconds).toBe(4 * 24 * 3600);
  });

  it('judges freshness by the latest successful check, not only the last changed publication', () => {
    const now = new Date('2026-10-05T00:00:00.000Z');
    const published = run('2026-10-01T00:00:00.000Z'); // 96h old: stale for a 48h source
    const rechecked = {
      ...source('congress-legislators', published),
      freshness: {
        lastAttemptAt: '2026-10-04T23:00:00.000Z',
        lastAttemptOutcome: 'unchanged' as const,
        lastSuccessfulCheckAt: '2026-10-04T23:00:00.000Z', // an unchanged recheck 1h ago
        lastChangedAt: '2026-10-01T00:00:00.000Z',
        coverageThrough: null,
        coverageBasis: null,
      },
    };
    const [result] = assessSources([rechecked], now, 24 * 14);
    expect(result?.freshness).toBe('fresh');
    expect(result?.lastSuccessAt).toBe('2026-10-04T23:00:00.000Z');
    expect(result?.lastChangedAt).toBe('2026-10-01T00:00:00.000Z');
    // A server without the freshness fields still assesses from lastSuccess.
    const legacy = { ...source('congress-legislators', published), freshness: undefined };
    expect(assessSources([legacy as never], now, 24 * 14)[0]?.freshness).toBe('stale');
  });

  it('allows the Census boundaries source about 400 days, not the 14-day default', () => {
    const loaded = run('2025-10-20T00:00:00.000Z');
    const at = (iso: string) =>
      assessSources([source('census-boundaries', loaded)], new Date(iso), 24 * 14)[0];
    // A year after the last run: still fresh (the default would have called it stale at 14 days).
    expect(at('2026-10-20T00:00:00.000Z')).toMatchObject({
      freshness: 'fresh',
      maxAgeSeconds: 400 * 24 * 3600,
    });
    expect(at('2026-11-24T00:00:00.000Z')?.freshness).toBe('fresh'); // day 400
    expect(at('2026-11-25T00:00:00.000Z')?.freshness).toBe('stale'); // day 401
  });
});
