import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, test } from '@playwright/test';

/**
 * Real-data visual QA: full-page light screenshots (desktop 1440, mobile 390) of the key
 * pages plus warm server timings, against a server on a real database (see
 * playwright.real.config.ts). Profiles are chosen from the data through /api/v1, so the
 * run never hardcodes a politician. Output: apps/web/screenshots/real/.
 */
const OUT = fileURLToPath(new URL('../screenshots/real/', import.meta.url));
const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
] as const;
const WARM_RUNS = 3;

interface Row {
  slug: string;
  isCurrent: boolean;
  tenureYears: number | null;
  totalReceiptsCents: number | null;
}

async function api<T>(request: APIRequestContext, name: string, input: unknown): Promise<T> {
  const res = await request.get(
    `/api/v1/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,
  );
  expect(res.ok(), `${name} ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

async function pickPages(request: APIRequestContext) {
  const table = (input: unknown) => api<{ rows: Row[] }>(request, 'explore.table', input);
  const [longest] = (
    await table({ sort: [{ column: 'tenureYears', direction: 'desc' }], limit: 1 })
  ).rows;
  const firstTerm = (
    await table({
      filters: { chamber: 'house' },
      sort: [{ column: 'tenureYears', direction: 'asc' }],
      limit: 100,
    })
  ).rows.find((r) => (r.tenureYears ?? 0) >= 1.5 && r.totalReceiptsCents !== null);
  const [senator] = (
    await table({
      filters: { chamber: 'senate' },
      sort: [{ column: 'outsideOpposeCents', direction: 'desc' }],
      limit: 1,
    })
  ).rows;
  const former = (
    await table({
      filters: { scope: 'all' },
      sort: [{ column: 'totalReceiptsCents', direction: 'desc' }],
      limit: 100,
    })
  ).rows.find((r) => !r.isCurrent);
  const areas = await api<{ items: { id: string; rollcallCount: number }[] }>(
    request,
    'policy.areas',
    {},
  );
  const area = areas.items.toSorted((a, b) => b.rollcallCount - a.rollcallCount)[0];
  if (!longest || !firstTerm || !senator || !former || !area) {
    throw new Error('Real database is missing a page subject');
  }
  return [
    { name: 'home', path: '/' },
    { name: 'explore', path: '/explore' },
    { name: 'explore-senate-pac', path: '/explore?chamber=senate&sort=pac.desc' },
    { name: 'profile-long-tenure', path: `/people/${longest.slug}` },
    { name: 'profile-first-term', path: `/people/${firstTerm.slug}` },
    { name: 'profile-former', path: `/people/${former.slug}` },
    { name: 'profile-senate', path: `/people/${senator.slug}` },
    {
      name: 'compare',
      path: `/compare?ids=${[longest.slug, firstTerm.slug, senator.slug].join(',')}`,
    },
    { name: 'policy-index', path: '/policy' },
    { name: 'policy-area', path: `/policy/${area.id}` },
    { name: 'frameworks', path: '/frameworks' },
    { name: 'sources', path: '/sources' },
  ];
}

test('real-data screenshots and page timings', async ({ page, request }) => {
  const pages = await pickPages(request);
  const timings: Record<
    string,
    { path: string; coldMs: number; warmMs: number[]; bytes: number; overflowPx: number[] }
  > = {};
  const overflows: string[] = [];
  for (const { name, path } of pages) {
    const runs: number[] = [];
    let bytes = 0;
    for (let i = 0; i <= WARM_RUNS; i++) {
      const started = performance.now();
      const res = await request.get(path);
      const body = await res.body();
      runs.push(Math.round(performance.now() - started));
      bytes = body.length;
      expect(res.status(), path).toBe(200);
    }
    const overflowPx: number[] = [];
    timings[name] = { path, coldMs: runs[0] ?? 0, warmMs: runs.slice(1), bytes, overflowPx };

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      overflowPx.push(overflow);
      if (overflow > 0) overflows.push(`${name} ${viewport.label}: ${overflow}px`);
      await page.screenshot({ path: `${OUT}${name}-${viewport.label}.png`, fullPage: true });
    }
  }
  writeFileSync(`${OUT}timings.json`, `${JSON.stringify(timings, null, 2)}\n`);
  expect(overflows, 'pages wider than the viewport').toEqual([]);
});
