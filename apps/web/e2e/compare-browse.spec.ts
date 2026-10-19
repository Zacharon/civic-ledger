import { expect, type Page, test } from '@playwright/test';

// Build a comparison by browsing only: table → profile → compare → table → profile → add,
// repeated, with no typing. The chosen members travel in the URL.

const members = (page: Page) => page.locator('thead th[scope="col"]');
const table = (page: Page) => page.getByRole('region', { name: /members of Congress/i });

async function openFromTable(page: Page, name: string) {
  await table(page).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
}

test('add members to a comparison by browsing the table, without typing', async ({ page }) => {
  await page.goto('/explore?sort=name.asc');
  const names = await table(page).locator('tbody tr th a').allInnerTexts();
  expect(names.length).toBeGreaterThanOrEqual(5);
  const [a, b, c, d, e] = names as [string, string, string, string, string];

  // First member: start a comparison from the profile.
  await openFromTable(page, a);
  await page.getByRole('link', { name: 'Compare with others' }).click();
  await expect(page.getByRole('heading', { name: 'Add one more member to compare' })).toBeVisible();

  // Back to the table with the comparison kept, sorted differently on the way.
  await page.getByRole('link', { name: 'Browse the table' }).click();
  await expect(page).toHaveURL(/compare=/);
  const banner = page.getByRole('region', { name: 'Comparison in progress' });
  await expect(banner).toContainText(a);
  await expect(banner).toContainText('Comparing 1 of 4');

  // Second member: add from their profile.
  await openFromTable(page, b);
  await expect(page.getByText(`Comparing ${a}.`)).toBeVisible();
  await page.getByRole('link', { name: 'Add to comparison (2 of 4)' }).click();
  await expect(page.getByRole('columnheader', { name: new RegExp(a) })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: new RegExp(b) })).toBeVisible();

  // Third member: from the comparison, pick from the table again; sorting keeps the list.
  await page.getByRole('link', { name: 'pick from the table' }).click();
  await table(page)
    .getByRole('link', { name: /Name.*sort/ })
    .first()
    .click();
  await expect(page).toHaveURL(/compare=/);
  await expect(banner).toContainText('Comparing 2 of 4');
  await openFromTable(page, c);
  await page.getByRole('link', { name: 'Add to comparison (3 of 4)' }).click();
  await expect(members(page)).toHaveCount(3);

  // A member already chosen offers the way back instead of a duplicate.
  await page.getByRole('link', { name: 'pick from the table' }).click();
  await openFromTable(page, a);
  await page.getByRole('link', { name: 'Back to comparison' }).click();
  await expect(members(page)).toHaveCount(3);

  // Fourth member fills the comparison; a fifth profile says so.
  await page.getByRole('link', { name: 'pick from the table' }).click();
  await openFromTable(page, d);
  await page.getByRole('link', { name: 'Add to comparison (4 of 4)' }).click();
  await expect(members(page)).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'pick from the table' })).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(`^${b}$`) }).click();
  await expect(page.getByRole('link', { name: 'Back to comparison' })).toBeVisible();
  await page.getByRole('link', { name: 'Find in table' }).click();
  await expect(banner).toContainText('The comparison is full');
  await page.getByRole('link', { name: 'Stop comparing' }).click();
  await expect(page).not.toHaveURL(/compare=/);
  await expect(banner).toHaveCount(0);
  await page.goto('/explore?sort=name.asc');
  await openFromTable(page, e);
  await expect(page.getByRole('link', { name: 'Compare with others' })).toBeVisible();
});
