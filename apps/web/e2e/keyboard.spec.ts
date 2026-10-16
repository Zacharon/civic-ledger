import { expect, type Page, test } from '@playwright/test';

async function tabUntil(page: Page, matches: () => Promise<boolean>, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await matches()) return;
  }
  throw new Error('Focus never reached the expected element');
}

const focusedText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '');

test('Explore is fully usable from the keyboard', async ({ page }) => {
  await page.goto('/explore');

  // The skip link is the first stop and moves focus to the main content.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  // Reach the "Raised" sort header and activate it with Enter.
  await tabUntil(page, async () => (await focusedText(page)).startsWith('Raised'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sort=total\.desc/);
  await expect(page.getByRole('columnheader', { name: /Total raised/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );

  // Rows' name links follow the headers in order; Enter opens the profile.
  await tabUntil(page, async () =>
    page.evaluate(() => Boolean(document.activeElement?.closest('tbody'))),
  );
  const name = await focusedText(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
});

test('filters and the column picker work with the keyboard', async ({ page }) => {
  await page.goto('/explore');
  await page.getByLabel('State', { exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page).toHaveURL(/state=[A-Z]{2}/);

  const trigger = page.getByRole('button', { name: /Columns/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Show columns')).toBeVisible();
  await dialog.getByLabel('Outside spending for').focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/cols=[^&]*outsideFor/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('columnheader', { name: /Outside spending for/ })).toBeVisible();
});
