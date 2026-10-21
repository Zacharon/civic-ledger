import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * District locator map on member profiles. The e2e database is the fictional seed, whose
 * states (ZV-ZZ) carry synthetic geometry labelled as such, so this covers the component and
 * its shared capability without real Census data. Real-data screenshots and the Census
 * vintage are in docs/evidence/district-maps-20261020/.
 */
const HOUSE = '/people/emerson-elderquay'; // ZV, district 3
const SENATE = '/people/avery-ashvale'; // ZV, Senate
const FORMER = '/people/cornelius-oakhurst'; // former House member

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('a House member gets a map named for the state and district', async ({ page }) => {
  await page.goto(HOUSE);
  const panel = page.getByRole('region', { name: 'Source records' });
  const map = panel.getByRole('img', {
    name: 'Map of Zevland with congressional district 3 highlighted',
  });
  await expect(map).toBeVisible();
  await expect(map.locator('path')).toHaveCount(2); // state outline + the district
  await expect(panel.locator('figure.district-locator')).toHaveAttribute('data-scope', 'district');
  // The caption names the publisher, the vintage and what the vintage does not show.
  const caption = panel.locator('figcaption');
  await expect(caption).toContainText(
    'District boundaries: Civic Ledger development seed (fictional), fictional demonstration geometry (not a real map).',
  );
  await expect(caption).toContainText('Shows district lines as of October 1, 2026.');
  await expect(caption).toContainText(
    'A state that redrew its districts after that date is not reflected.',
  );
});

test('a Senator gets the whole state highlighted, with no district path', async ({ page }) => {
  await page.goto(SENATE);
  const map = page.getByRole('img', { name: 'Map of Zevland with the whole state highlighted' });
  await expect(map).toBeVisible();
  await expect(map.locator('path')).toHaveCount(1);
  await expect(page.locator('figure.district-locator')).toHaveAttribute('data-scope', 'state');
});

test('a former member gets no map: a district number can mean a different area', async ({
  page,
}) => {
  await page.goto(FORMER);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Oakhurst');
  await expect(page.locator('figure.district-locator')).toHaveCount(0);
});

test('the map is the same fact API and MCP return for the member (accessible name and paths)', async ({
  page,
  request,
}) => {
  await page.goto(HOUSE);
  const shape = await (await request.get('/api/v1/districts.shape?slug=emerson-elderquay')).json();
  const svg = page.locator('figure.district-locator svg');
  await expect(svg).toHaveAttribute('aria-label', shape.description);
  await expect(svg).toHaveAttribute('viewBox', shape.viewBox);
  await expect(svg).toHaveAttribute('width', String(shape.width));
  await expect(svg).toHaveAttribute('height', String(shape.height));
  const paths = svg.locator('path');
  await expect(paths.nth(0)).toHaveAttribute('d', shape.statePath);
  await expect(paths.nth(1)).toHaveAttribute('d', shape.districtPath);
  expect(shape.asOf).toBe('2026-10-01');
  expect(shape.congress).toBe(119);
  expect(shape.provenance.sourceId).toBe('dev-seed');
});

test('uses neutral tokens: state in surface-sunk, district in ink-2, never party or vote colours', async ({
  page,
}) => {
  await page.goto(HOUSE);
  const colors = await page.evaluate(() => {
    const probe = document.createElement('i');
    document.body.append(probe);
    const resolve = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const paint = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      return { fill: style.fill, stroke: style.stroke };
    };
    const tokens = Object.fromEntries(
      [
        '--surface-sunk',
        '--line-control',
        '--ink-2',
        '--ink',
        '--party-dem-ink',
        '--party-rep-ink',
        '--party-dem-bg',
        '--party-rep-bg',
        '--vote-yea',
        '--vote-nay',
      ].map((t) => [t, resolve(t)]),
    );
    return {
      tokens,
      state: paint('.district-map-state'),
      highlight: paint('.district-map-highlight'),
    };
  });
  expect(colors.state).toEqual({
    fill: colors.tokens['--surface-sunk'],
    stroke: colors.tokens['--line-control'],
  });
  expect(colors.highlight?.fill).toBe(colors.tokens['--ink-2']);
  const forbidden = [
    '--party-dem-ink',
    '--party-rep-ink',
    '--party-dem-bg',
    '--party-rep-bg',
    '--vote-yea',
    '--vote-nay',
  ].map((t) => colors.tokens[t]);
  for (const paint of [
    colors.state?.fill,
    colors.state?.stroke,
    colors.highlight?.fill,
    colors.highlight?.stroke,
  ]) {
    expect(forbidden).not.toContain(paint);
  }
});

test('nothing animates, and size is fixed before paint (no layout shift)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(HOUSE, { waitUntil: 'domcontentloaded' });
  const svg = page.locator('figure.district-locator svg');
  const early = await svg.boundingBox();
  await page.waitForLoadState('networkidle');
  const late = await svg.boundingBox();
  expect(early).toEqual(late);
  expect(late?.width).toBe(240);
  expect(late?.height).toBe(180);
  const motion = await page.evaluate(() =>
    [...document.querySelectorAll('figure.district-locator, figure.district-locator *')].map(
      (el) => {
        const s = getComputedStyle(el);
        return [s.animationName, s.transitionDuration, s.transitionProperty];
      },
    ),
  );
  for (const [animation, duration] of motion) {
    expect(animation).toBe('none');
    expect(duration === '0s' || duration === undefined).toBe(true);
  }
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });
    for (const path of [HOUSE, SENATE]) {
      test(`${path} with its map has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('figure.district-locator')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations.map((v) => v.id)).toEqual([]);
      });
    }
  });
}

test.describe('phone (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the map fits the viewport, keeps its shape, and the page does not scroll sideways', async ({
    page,
  }) => {
    await page.goto(HOUSE);
    const svg = page.locator('figure.district-locator svg');
    const box = await svg.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
    // The aspect ratio matches the intrinsic size at any rendered width.
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(240 / 180, 1);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
    // Identity first, then the source records with the map, then the section nav.
    const top = async (selector: string) =>
      (await page.locator(selector).first().boundingBox())?.y ?? Number.NaN;
    expect(await top('h1')).toBeLessThan(await top('figure.district-locator'));
    expect(await top('figure.district-locator')).toBeLessThan(
      await top('nav[aria-label="On this page"]'),
    );
  });
});
