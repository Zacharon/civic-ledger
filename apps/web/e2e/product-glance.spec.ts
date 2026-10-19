import type { CapabilityOutput } from '@civic-ledger/core';
import { expect, test } from '@playwright/test';

test('plain-language overview exposes the same sentences, raw facts and explainers as the API', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/v1/people.glance?slug=avery-ashvale');
  expect(response.status()).toBe(200);
  const glance = (await response.json()) as CapabilityOutput<'people.glance'>;
  await page.goto('/people/avery-ashvale');
  const section = page.locator('#glance');
  await expect(section.getByRole('heading', { name: 'At a glance', exact: true })).toBeVisible();
  for (const paragraph of glance.paragraphs) {
    for (const sentence of paragraph.sentences) {
      await expect(
        section.locator(`[data-sentence="${sentence.id}"] [data-sentence-text]`),
      ).toHaveText(sentence.text);
      for (const part of sentence.parts) {
        if (part.kind !== 'value') continue;
        const value = section.locator(
          `[data-sentence="${sentence.id}"] [data-glance-fact="${part.fact}"]`,
        );
        await expect(value).toHaveAttribute('data-value', JSON.stringify(part.value));
      }
    }
  }
  await expect(section).toContainText('not personal pay');
  await section.getByRole('link', { name: 'PACs and other committees', exact: true }).click();
  await expect(page).toHaveURL(/\/methodology#explainer-pac$/);
  const definitions = await request.get('/api/v1/explainers.list');
  expect(definitions.status()).toBe(200);
  const explainers = (await definitions.json()) as CapabilityOutput<'explainers.list'>;
  for (const explainer of explainers.items) {
    await expect(page.locator(`#explainer-${explainer.id}`)).toContainText(explainer.question);
    for (const answer of explainer.answer)
      await expect(page.locator(`#explainer-${explainer.id}`)).toContainText(answer);
  }
});

test('finder and district controls retain state senators, support zero, and clear district with state', async ({
  page,
  request,
}) => {
  const facetsResponse = await request.get('/api/v1/explore.facets');
  const facets = (await facetsResponse.json()) as CapabilityOutput<'explore.facets'>;
  const seat = facets.districts[0];
  expect(seat).toBeDefined();
  if (!seat) return;
  const expectedResponse = await request.get(
    `/api/v1/explore.table?filters.state=${seat.state}&filters.district=${seat.district}&limit=100`,
  );
  expect(expectedResponse.status()).toBe(200);
  const expected = (await expectedResponse.json()) as CapabilityOutput<'explore.table'>;
  expect(expected.rows.some((row) => row.chamber === 'house')).toBe(true);
  // The fictional seed has senators in the first House seat's state.
  expect(expected.rows.some((row) => row.chamber === 'senate')).toBe(true);
  await page.goto('/');
  await page.getByLabel('State or territory', { exact: true }).selectOption(seat.state);
  await page.getByLabel('House district (optional)', { exact: true }).fill(String(seat.district));
  await page.getByRole('button', { name: 'Find members', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`district=${seat.district}`));
  const table = page.getByRole('region', { name: /members of Congress/i });
  await expect(table.locator('tbody tr')).toHaveCount(expected.total);
  for (const row of expected.rows)
    await expect(table.getByRole('link', { name: row.fullName, exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('senators');
  await page.getByLabel('House district', { exact: true }).selectOption('');
  await expect(page).not.toHaveURL(/district=/);

  await page.goto('/');
  await page.getByLabel('State or territory', { exact: true }).selectOption(seat.state);
  await page.getByLabel('House district (optional)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Find members', exact: true }).click();
  await expect(page).toHaveURL(/district=0/);
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('at-large');
  const another = facets.states.find((state) => state.value !== seat.state);
  if (!another) throw new Error('Expected a second fictional state');
  await page.getByLabel('State', { exact: true }).selectOption(another.value);
  await expect(page).not.toHaveURL(/district=/);
});

test('finder works without scripts and an empty district shows every loaded current member in the state', async ({
  browser,
  baseURL,
  request,
}) => {
  const response = await request.get('/api/v1/explore.facets');
  const facets = (await response.json()) as CapabilityOutput<'explore.facets'>;
  const state = facets.states[0];
  if (!state) throw new Error('Expected fictional states');
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('State or territory', { exact: true }).selectOption(state.value);
    await page.getByRole('button', { name: 'Find members', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`state=${state.value}`));
    const table = page.getByRole('region', { name: /members of Congress/i });
    await expect(table.locator('tbody tr')).toHaveCount(state.count);
    await expect(page.getByRole('list', { name: 'Active filters' })).not.toContainText('at-large');
  } finally {
    await context.close();
  }
});
