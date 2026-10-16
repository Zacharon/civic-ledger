import { expect, test } from '@playwright/test';

test('Explore state round-trips through the URL', async ({ page }) => {
  await page.goto('/explore?chamber=house&sort=pac.desc&cols=total,pac,missed&size=25');

  await expect(page.getByRole('radio', { name: 'House' })).toBeChecked();
  await expect(page.getByLabel('Sort by')).toHaveValue('pac.desc');
  await expect(page.getByLabel('Rows')).toHaveValue('25');
  const table = page.getByRole('region', { name: /Members of Congress/ });
  await expect(table.getByRole('columnheader', { name: /from PACs/i })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(table.getByRole('columnheader', { name: /small-dollar/i })).toHaveCount(0);

  // A change made in the UI lands in the URL…
  await page.getByLabel('Sort by').selectOption('missed.asc');
  await expect(page).toHaveURL(/sort=missed\.asc/);
  await expect(page).toHaveURL(/chamber=house/);

  // …survives a reload, and Back restores the previous view.
  await page.reload();
  await expect(page.getByLabel('Sort by')).toHaveValue('missed.asc');
  await page.goBack();
  await expect(page).toHaveURL(/sort=pac\.desc/);
  await expect(page.getByLabel('Sort by')).toHaveValue('pac.desc');
});

test('the default sort is neutral and never ideological', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByLabel('Sort by')).toHaveValue('');
  await expect(page.getByText(/sorted by state, then name/)).toBeVisible();
  await expect(page.locator('th[aria-sort]')).toHaveCount(0);
});

test('invalid URL state degrades to a readable message, not a crash', async ({ page }) => {
  await page.goto('/explore?sort=scorecard:no-such-publisher.desc');
  await expect(
    page.getByRole('alert').filter({ hasText: 'This view can’t be shown' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Reset the table' }).click();
  await expect(page.getByText(/sorted by state, then name/)).toBeVisible();

  const missing = await page.goto('/people/no-such-member');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'No entry in the ledger' })).toBeVisible();
});
