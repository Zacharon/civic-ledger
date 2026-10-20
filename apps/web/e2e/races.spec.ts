import { expect, test } from '@playwright/test';

/**
 * Races (DECISIONS A72): the index, a race page, the no-JavaScript state filter and
 * disclosure, the opt-in receipts order and the profile link. Business values are compared
 * with /api/v1 and MCP in shared-values.spec.ts; this file covers what a person does.
 */
const NOTICE =
  'FEC registration lists everyone who filed paperwork. It does not show who won a primary or who is on the November ballot.';

test('the nav links to Races and the index lists Senate and House seats by state', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026 races');
  await expect(page.locator('[data-registration-notice]')).toHaveText(NOTICE);
  await expect(page.getByRole('heading', { level: 2, name: 'Senate' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'House' })).toBeVisible();
  // Grouped by state: each House state is a heading over its own table of districts.
  await expect(page.getByRole('heading', { level: 3, name: /^ZV/ })).toBeVisible();
  const senate = page.locator('tr[data-seat="zv-senate"]');
  await expect(senate.getByRole('link', { name: 'ZV' })).toHaveAttribute(
    'href',
    '/races/2026/zv-senate',
  );
  await expect(senate.getByRole('link', { name: 'Blair Brindlemoor' })).toBeVisible();
  await expect(senate).toHaveAttribute('data-value', '[5,4,3]');
  // A seat that is up with nobody registered yet is listed with explicit zeros.
  await expect(page.locator('tr[data-seat="zv-2"]')).toHaveAttribute('data-value', '[0,0,0]');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the state filter is an ordinary GET form', async ({ page }) => {
    await page.goto('/races');
    await page.getByLabel('State or territory').selectOption('ZW');
    await page.getByRole('button', { name: 'Show races' }).click();
    await expect(page).toHaveURL(/\/races\?state=ZW/);
    const seats = await page
      .locator('tr[data-seat]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-seat')));
    expect(seats.length).toBeGreaterThan(1);
    expect(seats.every((key) => key?.startsWith('zw-'))).toBe(true);
    await expect(page.getByLabel('State or territory')).toHaveValue('ZW');
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/races$/);
  });

  test('candidates without a money report sit behind a disclosure that opens', async ({ page }) => {
    await page.goto('/races/2026/zv-senate');
    const details = page.locator('details[data-no-report-count]');
    await expect(details).toHaveAttribute('data-no-report-count', '2');
    const hidden = page.locator('tr[data-candidate="S6ZV00003"]');
    await expect(hidden).toBeHidden();
    await details.getByText('2 registered candidates have no money report').click();
    await expect(hidden).toBeVisible();
    await expect(page.locator('tr[data-candidate="S6ZV00004"]')).toBeVisible();
  });
});

test('a race page states the seat, the incumbent, the notice and every candidate', async ({
  page,
}) => {
  await page.goto('/races/2026/zv-senate');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ZV Senate');
  await expect(page.locator('main')).toContainText('2026 Senate race');
  await expect(page.locator('[data-seat-up]')).toContainText(
    'Seat up in 2026: a sitting member’s term ends Jan 3, 2027.',
  );
  await expect(page.locator('[data-incumbents]')).toContainText('Incumbent:');
  await expect(
    page.locator('[data-incumbents]').getByRole('link', { name: 'Blair Brindlemoor' }),
  ).toHaveAttribute('href', '/people/blair-brindlemoor');
  await expect(page.locator('[data-registration-notice]')).toHaveText(NOTICE);
  await expect(page.locator('[data-race-counts]')).toHaveAttribute('data-race-counts', '[5,4,3,2]');

  // Matched candidates link to the member profile; unmatched ones are plain text.
  const incumbent = page.locator('tr[data-candidate="S4ZV00002"]');
  await expect(incumbent.getByRole('link', { name: 'Blair Brindlemoor' })).toHaveAttribute(
    'href',
    '/people/blair-brindlemoor',
  );
  const challenger = page.locator('tr[data-candidate="S6ZV00001"]');
  await expect(challenger.getByRole('link', { name: 'Rowan Townsend-Fell' })).toHaveCount(0);
  await expect(challenger.locator('th')).toContainText('Rowan Townsend-Fell');
  await expect(challenger.locator('th')).toContainText('Filed as TOWNSEND-FELL, ROWAN');
  await expect(challenger.getByRole('link', { name: /FEC S6ZV00001/ })).toHaveAttribute(
    'href',
    'https://www.fec.gov/data/candidate/S6ZV00001/',
  );
  await expect(challenger).toContainText('Challenger');
  await expect(challenger).toContainText('Statutory candidate');
  await expect(challenger).toContainText('$4,210,000');
  await expect(challenger).toContainText('Sep 30, 2026');
  await expect(challenger).toContainText('$400,000');
  await expect(challenger).toContainText('$75,000');

  // Cash on hand is shown as filed, including a negative figure.
  const negative = page.locator('tr[data-candidate="S6ZV00002"]');
  await expect(negative.locator('th')).toContainText('Dr. Marguerite Anne Quillon');
  await expect(negative).toContainText('−$12,000');
  await expect(negative).toContainText('as filed');

  // Source footnote with the FEC download date.
  await expect(page.locator('main')).toContainText('Sources for this race');
  await expect(page.locator('main')).toContainText('FEC files downloaded Oct 1, 2026.');
});

test('money bars share one scale and the default order is by name', async ({ page }) => {
  await page.goto('/races/2026/zv-senate');
  const order = await page
    .locator('table:has(th:text("Raised")) tr[data-candidate]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-candidate')));
  // Alphabetical by name as filed: BRINDLEMOOR, QUILLON, TOWNSEND-FELL.
  expect(order).toEqual(['S4ZV00002', 'S6ZV00002', 'S6ZV00001']);
  const widths = await page
    .locator('tr[data-candidate] .share')
    .evaluateAll((bars) => bars.map((b) => (b as HTMLElement).style.getPropertyValue('--v')));
  // The largest receipts fill the scale; the others are a proportion of it.
  expect(widths).toEqual(['100%', '3.2%', '42.9%']);
  const color = await page
    .locator('tr[data-candidate="S4ZV00002"] .share')
    .evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
  expect(color).toContain('rgb');
  await expect(page.locator('.vote-meter, .vote-key')).toHaveCount(0);
});

test('amount raised order is opt-in and says so', async ({ page }) => {
  await page.goto('/races/2026/zv-senate');
  await expect(page.getByRole('navigation', { name: 'Order candidates' })).toContainText('Name');
  await page.getByRole('link', { name: 'Amount raised' }).click();
  await expect(page).toHaveURL(/\?sort=receipts$/);
  const order = await page
    .locator('table:has(th:text("Raised")) tr[data-candidate]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-candidate')));
  expect(order).toEqual(['S4ZV00002', 'S6ZV00001', 'S6ZV00002']);
  await expect(page.locator('main')).toContainText('Largest amount raised first, as you asked.');
});

test('an at-large open seat has no incumbent and a seat key of its own', async ({ page }) => {
  await page.goto('/races/2026/zv-al');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ZV at-large district');
  await expect(page.locator('[data-seat-up]')).toContainText('No sitting member’s term');
  await expect(page.locator('[data-incumbents]')).toContainText('No incumbent on file');
  await expect(page.locator('tr[data-candidate="H6ZV00001"]')).toContainText('Open seat');
  await expect(page.locator('tr[data-candidate="H6ZV00001"] th')).toContainText('Juno Bramblewick');
});

test('a seat where nobody has a money report says so and opens the list', async ({ page }) => {
  await page.goto('/races/2026/zw-3');
  await expect(page.locator('[data-no-money-reports]')).toContainText(
    'No candidate in this race has a money report on file yet.',
  );
  const details = page.locator('details[data-no-report-count]');
  await expect(details).toHaveAttribute('open', '');
  await expect(page.locator('tr[data-candidate]')).toHaveCount(2);
  await expect(page.locator('tr[data-candidate="H6ZW03001"]')).toContainText(
    'Not yet a statutory candidate',
  );
});

test('a member profile links to the member’s race', async ({ page }) => {
  await page.goto('/people/blair-brindlemoor');
  const line = page.locator('[data-race-links]');
  await expect(line).toContainText('2026 race:');
  await line.getByRole('link', { name: 'ZV Senate' }).click();
  await expect(page).toHaveURL(/\/races\/2026\/zv-senate$/);
  await page.goto('/people/cornelius-oakhurst');
  await expect(page.locator('[data-race-links] a')).toHaveAttribute('href', '/races/2026/zv-1');
  // A senator whose term runs to 2029 and who did not register has no 2026 race.
  await page.goto('/people/avery-ashvale');
  await expect(page.locator('[data-race-links]')).toHaveCount(0);
});

test('unknown races and malformed addresses are 404s', async ({ page }) => {
  for (const path of [
    '/races/2026/zy-al',
    '/races/2026/ZV-1',
    '/races/2026/zv-01',
    '/races/26/zv-1',
    '/races/2024/zv-1',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
