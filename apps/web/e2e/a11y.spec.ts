import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const PAGES = [
  '/',
  '/explore',
  '/explore?chamber=senate&sort=total.desc&cols=tenure,total,pac,small,industries,coverage,outsideFor,outsideAgainst,missed,eligible,dim1,dim2,kept,rated',
  '/people/avery-ashvale',
  '/compare',
  '/compare?ids=avery-ashvale,blair-brindlemoor,cameron-corrowind',
  '/policy',
  '/policy/health',
  '/frameworks',
  '/frameworks?build=1',
  '/sources',
  '/methodology',
  '/no-such-page',
];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map(
    (v) =>
      `${v.id}: ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });
    for (const path of PAGES) {
      test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.goto(path);
        expect(await violations(page)).toEqual([]);
      });
    }

    test('framework results have no violations', async ({ page }) => {
      await page.goto('/frameworks');
      await page
        .getByRole('link', { name: /^Evaluate/ })
        .first()
        .click();
      await expect(page).toHaveURL(/f=/);
      expect(await violations(page)).toEqual([]);
    });

    test('open column picker has no violations', async ({ page }) => {
      await page.goto('/explore');
      await page.getByRole('button', { name: /Columns/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe('axe (mobile, 390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of ['/', '/explore', '/people/avery-ashvale']) {
    test(`${path} has no violations on a phone`, async ({ page }) => {
      await page.goto(path);
      expect(await violations(page)).toEqual([]);
    });
  }
});
