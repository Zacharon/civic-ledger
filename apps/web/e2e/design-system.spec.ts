import { expect, test } from '@playwright/test';

/**
 * Swiss × Editorial restyle guards (DESIGN.md): every route reflows without page-level
 * horizontal scrolling, search stays usable on phones, vote meters and legends agree,
 * vote colors come from the vote tokens, and source records sit near the top of a record.
 */
const ROUTES = [
  '/',
  '/explore',
  '/people/avery-ashvale',
  '/people/blair-brindlemoor',
  '/races',
  '/races?state=ZV',
  '/races/2026/zv-senate',
  '/races/2026/zv-al',
  '/races/2026/zw-3',
  '/policy',
  '/policy/health',
  '/compare?ids=avery-ashvale,blair-brindlemoor,cameron-corrowind',
  '/frameworks?f=sample-public-investment',
  '/sources',
  '/methodology',
];

// 720 is a 1440px window at 200% zoom.
for (const width of [320, 390, 720, 768, 1024, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test('no route scrolls the whole page sideways', async ({ page }) => {
      for (const route of ROUTES) {
        await page.goto(route);
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(scroll, `${route} at ${width}px`).toBeLessThanOrEqual(client);
      }
    });
  });
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('header search is visible and runs the Explore name filter', async ({ page }) => {
    await page.goto('/people/avery-ashvale');
    const search = page.getByRole('searchbox', { name: 'Search members by name' });
    await expect(search).toBeVisible();
    await search.fill('Ashvale');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/explore\?q=Ashvale/);
    await expect(page.getByRole('link', { name: 'Avery Ashvale' }).first()).toBeVisible();
  });

  test('profile reads identity, then source records, then sections', async ({ page }) => {
    await page.goto('/people/avery-ashvale');
    const top = async (selector: string) =>
      (await page.locator(selector).first().boundingBox())?.y ?? Number.NaN;
    const h1 = await top('h1');
    const evidence = await top('#evidence-title');
    const sections = await top('nav[aria-label="On this page"]');
    expect(h1).toBeLessThan(evidence);
    expect(evidence).toBeLessThan(sections);
  });
});

test('profile source records link to real identifiers and hold the header footnotes', async ({
  page,
}) => {
  await page.goto('/people/avery-ashvale');
  const panel = page.getByRole('region', { name: 'Source records' });
  await expect(
    panel.getByRole('link', { name: 'Congressional Biographical Directory' }),
  ).toHaveAttribute('href', /bioguide\.congress\.gov/);
  // The h1 source mark resolves to a footnote inside the panel.
  const mark = page.locator('h1').getByRole('link', { name: 'Source 1' });
  const target = (await mark.getAttribute('href')) ?? '';
  await expect(panel.locator(target)).toHaveCount(1);
});

test('vote meters, legends and denominators come from the same counts', async ({ page }) => {
  await page.goto('/policy/health');
  const tallies = page.locator('[data-tally-total]');
  expect(await tallies.count()).toBeGreaterThan(0);
  for (const tally of await tallies.all()) {
    const total = Number(await tally.getAttribute('data-tally-total'));
    const counts = await tally
      .locator('[data-vote]')
      .evaluateAll((items) =>
        items.map((li) => Number(li.querySelector('.num')?.textContent?.replace(/,/g, ''))),
      );
    expect(counts).toHaveLength(4); // Yea, Nay, Present, Not voting: never merged.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
    const segments = tally.locator('.vote-meter > span');
    expect(await segments.count()).toBe(counts.filter((c) => c > 0).length);
    await expect(tally).toContainText(`Of ${total} recorded positions`);
  }
});

test('vote fills use the vote tokens, not party colors', async ({ page }) => {
  await page.goto('/policy/health');
  const colors = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const probe = (className: string) => {
      const el = document.querySelector(`.vote-meter > .${className}, .vote-key.${className}`);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    const rgb = (hex: string) => {
      const h = hex.trim();
      return `rgb(${[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
    };
    return {
      yea: [probe('vote-yea'), rgb(css.getPropertyValue('--vote-yea'))],
      nay: [probe('vote-nay'), rgb(css.getPropertyValue('--vote-nay'))],
      notVoting: [probe('vote-not-voting'), rgb(css.getPropertyValue('--vote-not-voting'))],
      party: [
        rgb(css.getPropertyValue('--party-dem-ink')),
        rgb(css.getPropertyValue('--party-rep-ink')),
        rgb(css.getPropertyValue('--party-dem-bg')),
        rgb(css.getPropertyValue('--party-rep-bg')),
      ],
    };
  });
  for (const key of ['yea', 'nay', 'notVoting'] as const) {
    const [actual, token] = colors[key];
    expect(actual, key).toBe(token);
    expect(colors.party, key).not.toContain(actual);
  }
});
