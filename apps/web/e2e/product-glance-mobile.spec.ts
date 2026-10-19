import type { CapabilityOutput } from '@civic-ledger/core';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { formatCents, formatShare } from '../src/lib/format';

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE });

type Table = CapabilityOutput<'explore.table'>;
type Glance = CapabilityOutput<'people.glance'>;

async function api<T>(request: APIRequestContext, name: string, input: unknown = {}): Promise<T> {
  const response = await request.get(
    `/api/v1/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,
  );
  expect(response.status(), name).toBe(200);
  return (await response.json()) as T;
}

async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(page.viewportSize()).toEqual(MOBILE);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `horizontal overflow on ${new URL(page.url()).pathname}`).toBeLessThanOrEqual(0);
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 80; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('The expected link could not be reached with Tab');
}

async function overviewMatches(page: Page, glance: Glance) {
  const section = page.getByRole('region', { name: 'At a glance', exact: true });
  await expect(section.getByRole('heading', { name: 'At a glance', exact: true })).toBeVisible();
  for (const paragraph of glance.paragraphs) {
    for (const sentence of paragraph.sentences) {
      const shown = section.locator(`[data-sentence="${sentence.id}"]`);
      await expect(shown.locator('[data-sentence-text]')).toHaveText(sentence.text);
      for (const part of sentence.parts) {
        if (part.kind !== 'value') continue;
        await expect(shown.locator(`[data-glance-fact="${part.fact}"]`)).toHaveAttribute(
          'data-value',
          JSON.stringify(part.value),
        );
      }
    }
  }
  return section;
}

/** Observe the visible card list, never the table hidden below the md breakpoint. */
async function cardsMatch(page: Page, expected: Table) {
  expect(expected.rows.length, 'fictional state has loaded members').toBeGreaterThan(0);
  expect(expected.total, 'fictional state fits the first UI page').toBeLessThanOrEqual(25);
  const list = page.locator('main ol').filter({ has: page.locator('a[href^="/people/"]') });
  await expect(list).toBeVisible();
  const cards = list.locator(':scope > li');
  await expect(cards).toHaveCount(expected.total);
  await expect(cards.locator(':scope > div > a')).toHaveText(expected.rows.map((r) => r.fullName));
  for (const [index, row] of expected.rows.entries()) {
    const card = cards.nth(index);
    await expect(card.getByRole('link', { name: row.fullName, exact: true })).toBeVisible();
    for (const [label, value] of [
      ['Raised', formatCents(row.totalReceiptsCents, { compact: true })],
      ['From PACs', formatShare(row.pacShare)],
      ['Small donors', formatShare(row.smallDollarShare)],
    ] as const) {
      const metric = card
        .locator('dl > div')
        .filter({ has: page.getByText(label, { exact: true }) });
      await expect(metric.locator('dd')).toHaveText(value ?? 'No data');
    }
  }
  await noOverflow(page);
}

test('mobile overview keeps API facts and missing coverage readable, with keyboard source and explainer links', async ({
  page,
  request,
}) => {
  const glance = await api<Glance>(request, 'people.glance', { slug: 'avery-ashvale' });
  await page.goto('/people/avery-ashvale');
  const section = await overviewMatches(page, glance);
  await noOverflow(page);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  const sourceMark = section.getByRole('link', { name: 'Source 1', exact: true }).first();
  await tabTo(page, sourceMark);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#glance-source-1$/);
  const note = page.locator('#glance-source-1');
  await expect(note).toBeInViewport();
  await expect(note).toContainText('Retrieved');
  await expect(note).toContainText('ingest run');
  const source = glance.paragraphs
    .flatMap((p) => p.sentences)
    .find((s) => s.provenance)?.provenance;
  if (!source) throw new Error('Populated overview must cite a source');
  const about = note.getByRole('link', { name: 'About this source', exact: true });
  await expect(about).toHaveAttribute('href', `/sources#source-${source.sourceId}`);
  await about.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/sources#source-${source.sourceId}$`));
  await expect(page.locator(`#source-${source.sourceId}`)).toContainText('Last successful load');
  await noOverflow(page);

  await page.goto('/people/avery-ashvale');
  const pac = page
    .locator('#glance')
    .getByRole('link', { name: 'PACs and other committees', exact: true });
  await pac.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/methodology#explainer-pac$/);
  const explainers = await api<CapabilityOutput<'explainers.list'>>(request, 'explainers.list');
  const definition = explainers.items.find((item) => item.id === 'pac');
  if (!definition) throw new Error('PAC definition must exist');
  const explanation = page.locator('#explainer-pac');
  await expect(explanation).toContainText(definition.question);
  for (const answer of definition.answer) await expect(explanation).toContainText(answer);
  await noOverflow(page);

  const all = await api<Table>(request, 'explore.table', { limit: 100 });
  const missing = all.rows.find((row) => row.totalReceiptsCents === null);
  if (!missing) throw new Error('Fictional seed must include missing campaign coverage');
  const sparse = await api<Glance>(request, 'people.glance', { slug: missing.slug });
  expect(sparse.facts.money).toBeNull();
  await page.goto(`/people/${missing.slug}`);
  const sparseSection = await overviewMatches(page, sparse);
  await expect(sparseSection.locator('[data-sentence="money.none"]')).toContainText(
    'Missing coverage does not mean no fundraising',
  );
  await expect(sparseSection.locator('[data-glance-fact="money.totalReceiptsCents"]')).toHaveCount(
    0,
  );
  await expect(sparseSection.locator('[data-sentence="say.none"]')).toContainText('coverage gap');
  await noOverflow(page);
});

test('mobile finder and district controls show the API members and money values in visible cards', async ({
  page,
  request,
}) => {
  const facets = await api<CapabilityOutput<'explore.facets'>>(request, 'explore.facets');
  const seat = facets.districts[0];
  if (!seat) throw new Error('Fictional seed must contain a House district');
  const expected = await api<Table>(request, 'explore.table', {
    filters: { state: seat.state, district: seat.district },
    limit: 100,
  });
  expect(expected.rows.some((r) => r.chamber === 'house')).toBe(true);
  expect(expected.rows.some((r) => r.chamber === 'senate')).toBe(true);
  await page.goto('/');
  await noOverflow(page);
  await page.getByLabel('State or territory', { exact: true }).selectOption(seat.state);
  await page.getByLabel('House district (optional)', { exact: true }).fill(String(seat.district));
  await page.getByRole('button', { name: 'Find members', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`district=${seat.district}`));
  await cardsMatch(page, expected);
  await expect(page.getByRole('list', { name: 'Active filters', exact: true })).toContainText(
    'senators',
  );

  await page.getByLabel('House district', { exact: true }).selectOption('');
  await expect(page).not.toHaveURL(/district=/);
  await cardsMatch(
    page,
    await api<Table>(request, 'explore.table', {
      filters: { state: seat.state },
      limit: 100,
    }),
  );

  // The fictional seed has no district 0: senators remain; no House seat is invented.
  const atLarge = await api<Table>(request, 'explore.table', {
    filters: { state: seat.state, district: 0 },
    limit: 100,
  });
  expect(atLarge.rows.some((row) => row.chamber === 'house')).toBe(false);
  await page.goto('/');
  await page.getByLabel('State or territory', { exact: true }).selectOption(seat.state);
  await page.getByLabel('House district (optional)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Find members', exact: true }).click();
  await expect(page).toHaveURL(/district=0/);
  await expect(page.getByRole('list', { name: 'Active filters', exact: true })).toContainText(
    'at-large',
  );
  await expect(page.getByLabel('House district', { exact: true })).toContainText('no seat loaded');
  await cardsMatch(page, atLarge);

  const all = await api<Table>(request, 'explore.table', { limit: 100 });
  const missing = all.rows.find(
    (row) => row.totalReceiptsCents === null && row.state !== seat.state,
  );
  if (!missing?.state) throw new Error('Expected another fictional state with missing money data');
  await page.getByLabel('State', { exact: true }).selectOption(missing.state);
  await expect(page).not.toHaveURL(/district=/);
  await cardsMatch(
    page,
    await api<Table>(request, 'explore.table', {
      filters: { state: missing.state },
      limit: 100,
    }),
  );
});

test('mobile finder without scripts leaves blank district unfiltered and renders all loaded state cards', async ({
  browser,
  baseURL,
  request,
}) => {
  const facets = await api<CapabilityOutput<'explore.facets'>>(request, 'explore.facets');
  const state = facets.states[0];
  if (!state) throw new Error('Fictional seed must contain states');
  const expected = await api<Table>(request, 'explore.table', {
    filters: { state: state.value },
    limit: 100,
  });
  expect(expected.total).toBe(state.count);
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: MOBILE });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await noOverflow(page);
    await expect(
      page.getByText(
        'Results reflect loaded records; vacancies and missing seats may leave gaps.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByLabel('State or territory', { exact: true }).selectOption(state.value);
    await expect(page.getByLabel('House district (optional)', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Find members', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`state=${state.value}`));
    expect(new URL(page.url()).searchParams.get('district') ?? '').toBe('');
    await expect(page.getByRole('list', { name: 'Active filters', exact: true })).not.toContainText(
      'at-large',
    );
    await cardsMatch(page, expected);
  } finally {
    await context.close();
  }
});
