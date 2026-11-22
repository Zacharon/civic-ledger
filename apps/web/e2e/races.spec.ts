import { expect, test } from '@playwright/test';

/**
 * Races (DECISIONS A86 to A95): the index, a race page, the no-JavaScript state filter, the
 * opt-in receipts order and the profile link. Business values are compared with /api/v1 and
 * MCP in shared-values.spec.ts; this file covers what a person does.
 */
const NOTICE =
  'FEC registration lists everyone who filed paperwork. It does not show who won a primary or who is on the November ballot.';

test('the nav links to Races; the index shows the Senate and the House by state', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026 races');
  await expect(page.locator('[data-registration-notice]')).toHaveText(NOTICE);
  await expect(page.getByRole('heading', { level: 2, name: 'Senate' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'House' })).toBeVisible();
  const senate = page.locator('tr[data-seat="zv-senate"]');
  await expect(senate.getByRole('link', { name: 'ZV' })).toHaveAttribute(
    'href',
    '/races/2026/zv-senate',
  );
  await expect(senate.getByRole('link', { name: 'Blair Brindlemoor' })).toBeVisible();
  await expect(senate).toHaveAttribute('data-value', '[5,4,3]');
  // The House is one line per state; its districts open from that state.
  await expect(page.locator('tr[data-seat="zv-2"]')).toHaveCount(0);
  const line = page.locator('li[data-state-summary="ZV"]');
  await expect(line).toHaveAttribute('data-value', '[6,4]');
  await line.getByRole('link', { name: 'ZV' }).click();
  await expect(page).toHaveURL(/\/races\?state=ZV$/);
  // A seat that is up with nobody registered yet is listed with explicit zeros.
  await expect(page.locator('tr[data-seat="zv-2"]')).toHaveAttribute('data-value', '[0,0,0]');
  await expect(page.getByRole('heading', { level: 3, name: /^ZV/ })).toBeVisible();
});

test('the default page stays small', async ({ request }) => {
  const response = await request.get('/races');
  expect(response.status()).toBe(200);
  expect((await response.body()).length).toBeLessThan(150_000);
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

  test('the chamber filter shows the House by state without any seat table', async ({ page }) => {
    await page.goto('/races');
    await page.getByLabel('Chamber').selectOption('house');
    await page.getByRole('button', { name: 'Show races' }).click();
    await expect(page).toHaveURL(/chamber=house/);
    await expect(page.locator('li[data-state-summary]').first()).toBeVisible();
    await expect(page.locator('tr[data-seat]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Senate' })).toHaveCount(0);
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

test('everyone is in one table in name order; no report is a row, not a hidden group', async ({
  page,
}) => {
  await page.goto('/races/2026/zv-senate');
  await expect(page.locator('main details')).toHaveCount(0);
  const order = await page
    .locator('tr[data-candidate]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-candidate')));
  // Alphabetical by name as filed: BRINDLEMOOR, MCCRAE, O'LEARY-VANCE, QUILLON, TOWNSEND-FELL.
  expect(order).toEqual(['S4ZV00002', 'S6ZV00003', 'S6ZV00004', 'S6ZV00002', 'S6ZV00001']);
  for (const id of ['S6ZV00003', 'S6ZV00004']) {
    const row = page.locator(`tr[data-candidate="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-no-report]')).toHaveText('No report on file');
  }
  await expect(page.locator('main')).toContainText('does not mean a candidate raised nothing');
});

test('money bars share one scale and use neutral ink', async ({ page }) => {
  await page.goto('/races/2026/zv-senate');
  const widths = await page
    .locator('tr[data-candidate] .share')
    .evaluateAll((bars) => bars.map((b) => (b as HTMLElement).style.getPropertyValue('--v')));
  // Order: BRINDLEMOOR, QUILLON, TOWNSEND-FELL. The largest receipts fill the scale.
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
    .locator('tr[data-candidate]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-candidate')));
  expect(order).toEqual(['S4ZV00002', 'S6ZV00001', 'S6ZV00002', 'S6ZV00003', 'S6ZV00004']);
  await expect(page.locator('main')).toContainText('Largest amount raised first, as you asked');
});

test('an open seat lists the sitting member and registrants who all say open seat', async ({
  page,
}) => {
  await page.goto('/races/2026/zz-3');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ZZ 3rd district');
  await expect(page.locator('[data-seat-up]')).toContainText('Seat up in 2026');
  await expect(page.locator('tr[data-candidate="H6ZZ03011"]')).toContainText('Open seat');
  await expect(page.locator('tr[data-candidate="H6ZZ03011"] th')).toContainText('Juno Bramblewick');
  await expect(page.locator('tr[data-candidate="H6ZZ03013"] [data-no-report]')).toBeVisible();
});

test('a seat where nobody has a money report says so in every row', async ({ page }) => {
  await page.goto('/races/2026/zw-3');
  await expect(page.locator('tr[data-candidate]')).toHaveCount(2);
  await expect(page.locator('[data-no-report]')).toHaveCount(2);
  await expect(page.locator('tr[data-candidate="H6ZW03001"]')).toContainText(
    'Not yet a statutory candidate',
  );
});

test('a member profile links to the member’s race and repeats the notice', async ({ page }) => {
  await page.goto('/people/blair-brindlemoor');
  const line = page.locator('[data-race-links]');
  await expect(line).toContainText('2026 race:');
  await expect(line).toContainText('FEC registration is not a ballot listing');
  await line.getByRole('link', { name: 'ZV Senate' }).click();
  await expect(page).toHaveURL(/\/races\/2026\/zv-senate$/);
  await page.goto('/people/cornelius-oakhurst');
  await expect(page.locator('[data-race-links] a')).toHaveAttribute('href', '/races/2026/zv-1');
  // A senator whose term runs to 2029 and who did not register has no 2026 race.
  await page.goto('/people/avery-ashvale');
  await expect(page.locator('[data-race-links]')).toHaveCount(0);
});

test('unknown races and malformed addresses are 404s, never errors', async ({ page }) => {
  for (const path of [
    '/races/2026/zy-al',
    '/races/2026/zv-al',
    '/races/2026/zv-71',
    '/races/2026/ZV-1',
    '/races/2026/zv-01',
    '/races/26/zv-1',
    '/races/1900/zv-senate',
    '/races/2101/zv-senate',
    '/races/2025/zv-senate',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
