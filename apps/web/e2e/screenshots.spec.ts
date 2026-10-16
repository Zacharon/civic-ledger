import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Review evidence (committed under apps/web/screenshots): full-page captures of the key
 * pages in light and dark, desktop 1440 and mobile 390, against the fictional seed.
 * Run with `pnpm --filter @civic-ledger/web screenshots`.
 */
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'explore', path: '/explore' },
  { name: 'profile', path: '/people/avery-ashvale' },
  { name: 'compare', path: '/compare?ids=avery-ashvale,blair-brindlemoor,cameron-corrowind' },
  { name: 'frameworks', path: '/frameworks?f=sample-public-investment' },
  { name: 'sources', path: '/sources' },
];

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`${viewport.label} ${colorScheme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme,
        deviceScaleFactor: 1,
      });
      for (const { name, path } of PAGES) {
        test(name, async ({ page }) => {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          await page.evaluate(() => document.fonts.ready);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await page.screenshot({
            path: `${OUT}${name}-${viewport.label}-${colorScheme}.png`,
            fullPage: true,
          });
        });
      }
    });
  }
}
