import { expect, type Page, test } from '@playwright/test';

/**
 * H3-06: under load the Explore client chunks arrived ~0.8 s after the HTML, and a click
 * on an active-filter chip in that window did nothing. These tests hold every JS chunk
 * until after the user acts, so an action that depends on hydration is lost every time.
 */
async function holdScripts(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_next/static/chunks/**/*.js', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

const activeFilters = (page: Page) => page.getByRole('list', { name: 'Active filters' });

test('removing a filter before the page has hydrated is not lost', async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto('/explore?q=Ashvale&chamber=senate&sort=total.desc', {
    waitUntil: 'domcontentloaded',
  });
  await activeFilters(page)
    .getByText(/Name contains/)
    .click();
  release();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page).toHaveURL(/chamber=senate/);
  await expect(page).toHaveURL(/sort=total\.desc/);
  await expect(activeFilters(page).getByText(/Name contains/)).toHaveCount(0);
});

test('clearing every filter before the page has hydrated is not lost', async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto('/explore?q=Ashvale&chamber=senate&sort=total.desc&size=25', {
    waitUntil: 'domcontentloaded',
  });
  await activeFilters(page).getByText('Clear filters').click();
  release();
  await expect(page).not.toHaveURL(/q=|chamber=/);
  // Clearing filters keeps the view settings (sort, rows).
  await expect(page).toHaveURL(/sort=total\.desc/);
  await expect(page).toHaveURL(/size=25/);
  await expect(activeFilters(page).getByText('No filters.', { exact: false })).toBeVisible();
});

test('a filter removed after hydration still updates in place', async ({ page }) => {
  await page.goto('/explore?q=Ashvale&chamber=senate');
  // Wait for hydration: the column picker only opens once React owns the page.
  await expect(page.getByText(/current member/).first()).toBeVisible();
  await page.waitForFunction(() =>
    Object.keys(document.querySelector('ul[aria-label="Active filters"] button') ?? {}).some(
      (key) => key.startsWith('__reactProps'),
    ),
  );
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });
  await activeFilters(page)
    .getByText(/Name contains/)
    .click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page).toHaveURL(/chamber=senate/);
  // Hydrated, the chip is a client-side URL update, not a full page load.
  expect(documents).toEqual([]);
});

test('filters chosen before the page has hydrated are applied, not just drawn', async ({
  page,
}) => {
  const release = await holdScripts(page);
  await page.goto('/explore', { waitUntil: 'domcontentloaded' });
  await page
    .locator('label')
    .filter({ hasText: /^Senate$/ })
    .click();
  const stateSelect = page.getByLabel('State', { exact: true });
  const firstState = await stateSelect.locator('option').nth(1).getAttribute('value');
  await stateSelect.selectOption(firstState ?? '');
  await page.getByLabel('Sort by').selectOption('total.desc');
  release();
  await expect(page).toHaveURL(/chamber=senate/);
  await expect(page).toHaveURL(new RegExp(`state=${firstState}`));
  await expect(page).toHaveURL(/sort=total\.desc/);
  await expect(activeFilters(page).getByText('Senate')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Senate' })).toBeChecked();
});

test('a name typed before the page has hydrated is searched', async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto('/explore', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Name', { exact: true }).fill('Ashvale');
  release();
  await expect(page).toHaveURL(/q=Ashvale/);
  const table = page.getByRole('region', { name: /members of Congress/i });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Ashvale');
});
