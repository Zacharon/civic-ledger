import { expect, test } from '@playwright/test';

test('Explore state round-trips through the URL', async ({ page }) => {
  await page.goto('/explore?chamber=house&sort=pac.desc&cols=total,pac,missed&size=25');

  await expect(page.getByRole('radio', { name: 'House' })).toBeChecked();
  await expect(page.getByLabel('Sort by')).toHaveValue('pac.desc');
  await expect(page.getByLabel('Rows')).toHaveValue('25');
  const table = page.getByRole('region', { name: /members of Congress/i });
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

test('Explore shows current members by default and can include former members', async ({
  page,
}) => {
  await page.goto('/explore');
  await expect(page.getByRole('radio', { name: /Current members of Congress/ })).toBeChecked();
  await expect(page.getByText(/^40$/).first()).toBeVisible();
  const table = page.getByRole('region', { name: /members of Congress/i });
  await expect(table.getByRole('link', { name: 'Cornelius Oakhurst' })).toHaveCount(0);

  await page
    .locator('label')
    .filter({ hasText: /^Include former/ })
    .click();
  await expect(page).toHaveURL(/scope=all/);
  await expect(page.getByText(/43 current and former members/)).toBeVisible();
  await page.getByLabel('Sort by').selectOption('name.asc');
  await expect(table.getByRole('link', { name: 'Cornelius Oakhurst' })).toBeVisible();
  await expect(table.getByText('Former, 1995–2009')).toBeVisible();

  // A name search with no current match offers the former members instead.
  await page.goto('/explore?q=Wrenfield');
  await expect(page.getByText('1 former member matches this search.')).toBeVisible();
  await page.getByRole('link', { name: 'Include former members' }).click();
  await expect(page).toHaveURL(/scope=all/);
  await page.getByRole('link', { name: 'Philippa Wrenfield' }).first().click();
  await expect(page.getByText('Former member', { exact: true })).toBeVisible();
  await expect(page.getByText(/Served 2001–2019/)).toBeVisible();
});
