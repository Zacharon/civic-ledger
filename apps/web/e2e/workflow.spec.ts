import { expect, test } from '@playwright/test';

// The essential human workflow, with no AI anywhere in the loop:
// search → explore filter and sort → profile → compare → framework evaluate.
test('search, explore, profile, compare and evaluate a framework', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Find a member of Congress').fill('Ashvale');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL(/\/explore\?q=Ashvale/);
  const table = page.getByRole('region', { name: /members of Congress/i });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.getByRole('link', { name: 'Avery Ashvale' })).toBeVisible();

  // Filter: clear the name, keep only the Senate.
  await page.getByRole('button', { name: /Name contains/ }).click();
  await expect(page).not.toHaveURL(/q=/);
  await page
    .locator('label')
    .filter({ hasText: /^Senate$/ })
    .click();
  await expect(page).toHaveURL(/chamber=senate/);
  await expect(page.getByText(/^10 current members/)).toBeVisible();

  // Sort by total raised, largest first, via the column header.
  await table.getByRole('link', { name: /Total raised.*sort descending/ }).click();
  await expect(page).toHaveURL(/sort=total\.desc/);
  await expect(table.getByRole('columnheader', { name: /Total raised/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  const raised = await table.locator('tbody tr td:nth-child(4)').allInnerTexts();
  const dollars = raised.map((text) => Number.parseFloat(text.replace(/[^0-9.]/g, '')));
  expect(dollars.length).toBeGreaterThan(1);
  expect(dollars).toEqual([...dollars].sort((a, b) => b - a));

  // Profile of the top row.
  const firstName = await table.locator('tbody tr th a').first().innerText();
  await table.getByRole('link', { name: firstName }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(firstName);
  for (const section of ['Money', 'Votes', 'Scores', 'Promises', 'Platform and record', 'Career']) {
    await expect(page.getByRole('heading', { level: 2, name: section, exact: true })).toBeVisible();
  }
  // Every score is attributed with the publisher's self-described orientation.
  await expect(
    page
      .locator('#scores')
      .getByText(/Self-described:/)
      .first(),
  ).toBeVisible();
  await expect(page.locator('#money').getByRole('heading', { name: 'Sources' })).toBeVisible();

  // Compare: start from the profile, add a second member by name.
  await page.getByRole('link', { name: 'Compare with others' }).click();
  await expect(page.getByRole('heading', { name: 'Add one more member to compare' })).toBeVisible();
  await page.getByLabel(/Add a member/).fill('Dunmere');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/ids=[a-z-]+,dana-dunmere/);
  await expect(page.getByRole('columnheader', { name: /Dana Dunmere/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How often they voted alike' })).toBeVisible();

  // Frameworks: evaluate a published framework; the neutrality note is always there.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Frameworks' })
    .click();
  await expect(page.getByText('This is one framework’s view, not a neutral score.')).toBeVisible();
  await page
    .getByRole('link', { name: /^Evaluate/ })
    .first()
    .click();
  await expect(page).toHaveURL(/f=/);
  const results = page.getByRole('table', { name: /Alignment with this framework/ });
  await expect(results.getByText(/^\d+ of \d+$/).first()).toBeVisible();
  await expect(page.getByText('Stated orientation', { exact: true })).toBeVisible();

  // Show the exact votes behind one member's result.
  await results
    .getByText(/^Show \d+ votes?$/)
    .first()
    .click();
  await expect(results.getByText(/^Rule \d+:/).first()).toBeVisible();
});

test('build a framework from scratch; the spec lives in the URL', async ({ page }) => {
  await page.goto('/frameworks?build=1');
  await page.getByLabel('Framework name').fill('My test framework');
  await expect(page).toHaveURL(/title=My/);
  const firstRollcall = page
    .getByRole('group')
    .filter({ hasText: /roll call/ })
    .first();
  await firstRollcall.getByText('Yea aligns').click();
  await expect(page).toHaveURL(/rules=\d+\.(house|senate)\.\d+\.yea/);
  await expect(page.getByRole('heading', { level: 2, name: 'My test framework' })).toBeVisible();
  await expect(page.getByText('Built on this page; not reviewed or saved')).toBeVisible();

  // Reloading the URL reproduces the same framework and results.
  await page.goto(page.url());
  await expect(page.getByRole('heading', { level: 2, name: 'My test framework' })).toBeVisible();
  await expect(
    page
      .getByRole('table', { name: /Alignment with this framework/ })
      .getByText(/^\d+ of \d+$/)
      .first(),
  ).toBeVisible();
});
