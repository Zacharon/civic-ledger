import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CapabilityOutput } from '@civic-ledger/core';
import { expect, type Page, test } from '@playwright/test';
import { formatCents, formatNumber, formatShare, formatYears } from '../src/lib/format';
import { type PgStack, startPgStack } from './support/pg-stack';
import {
  checkHome,
  checkPolicy,
  checkSources,
  checkSupplementalProfile,
} from './support/supplemental-values';

/**
 * Seven-gate shared capabilities / shared state on the real UI path: what a person sees on
 * Explore, a profile, Compare and a framework result equals what /api/v1 and the MCP server
 * return for the same input, from one Postgres database, before and after a data change
 * plus read-model refresh, and after restarting both processes. Web and MCP run as
 * separate production processes on the select-only login.
 */
test.describe.configure({ mode: 'serial' });

let stack: PgStack;

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a fixtures pattern first
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  stack = await startPgStack({ restartable: true });
  await stack.startWeb();
  await stack.startMcp();
});

test.afterAll(async () => {
  await stack?.close();
});

type Json = Record<string, unknown>;
type Row = Json & { slug: string; fullName: string };

/** One capability through HTTP and MCP; asserts both agree and returns the payload. */
async function agreed<T>(name: string, input: Json): Promise<T> {
  const url = `${stack.baseUrl}/api/v1/${name}`;
  const response =
    name === 'frameworks.evaluate'
      ? await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      : await fetch(`${url}?input=${encodeURIComponent(JSON.stringify(input))}`);
  expect(response.status, `${name} over HTTP`).toBe(200);
  const http = (await response.json()) as T;
  const tool = await stack.mcp().callTool({ name: name.replace('.', '_'), arguments: input });
  expect(tool.isError, `${name} over MCP`).not.toBe(true);
  expect(tool.structuredContent, `${name}: MCP equals HTTP`).toEqual(http);
  return http;
}

/** Column id in the URL → the capability field it shows (written here, not imported). */
const FIELD: Record<string, (row: Row) => unknown> = {
  total: (r) => r.totalReceiptsCents,
  pac: (r) => r.pacShare,
  small: (r) => r.smallDollarShare,
  coverage: (r) => r.industryCodingCoverage,
  industries: (r) => (r.topIndustries as Array<{ name: string }>).map((i) => i.name),
  outsideFor: (r) => r.outsideSupportCents,
  outsideAgainst: (r) => r.outsideOpposeCents,
  missed: (r) => r.missedVoteRate,
  eligible: (r) => r.votesEligible,
  dim1: (r) => r.dwNominateDim1,
  dim2: (r) => r.dwNominateDim2,
  tenure: (r) => r.tenureYears,
  kept: (r) => r.promiseKeptRate,
  rated: (r) => r.promisesRated,
};
/** `scorecard:<publisher>` columns show that publisher's score for the row. */
function fieldFor(column: string): ((row: Row) => unknown) | undefined {
  if (!column.startsWith('scorecard:')) return FIELD[column];
  const publisherId = column.slice('scorecard:'.length);
  return (r) =>
    (r.scorecards as Array<{ publisherId: string; score: number }>).find(
      (c) => c.publisherId === publisherId,
    )?.score ?? null;
}
const SHARES = new Set(['pac', 'small', 'coverage', 'missed', 'kept']);

/** The text a person reads in a metric cell, from the API value and the app's formatters. */
function shownText(column: string, value: unknown): string | null {
  if (value === null) return null;
  if (column === 'total' || column.startsWith('outside')) {
    return formatCents(value as number, { compact: true });
  }
  if (SHARES.has(column)) return formatShare(value as number);
  if (column === 'eligible' || column === 'rated') return formatNumber(value as number);
  if (column === 'tenure') return formatYears(value as number);
  return null; // position strips and industry lists: compared by data-value only
}

interface Cell {
  owner: string;
  column: string;
  value: unknown;
  text: string;
}

async function cells(page: Page, selector: string): Promise<Cell[]> {
  const raw = await page.locator(selector).evaluateAll((tds) =>
    tds.map((td) => ({
      owner: td.closest('[data-slug]')?.getAttribute('data-slug') ?? td.getAttribute('data-slug'),
      column: td.getAttribute('data-column') ?? '',
      value: td.getAttribute('data-value') ?? 'undefined',
      text: (td as HTMLElement).innerText.trim(),
    })),
  );
  return raw.map((c) => ({ ...c, owner: c.owner ?? '', value: JSON.parse(c.value) }));
}

function expectCellsMatch(found: Cell[], rows: Row[]) {
  expect(found.length).toBeGreaterThan(0);
  for (const cell of found) {
    const row = rows.find((r) => r.slug === cell.owner);
    const field = fieldFor(cell.column);
    expect(row, `row ${cell.owner}`).toBeDefined();
    if (!row || !field) throw new Error(`unmapped cell ${cell.owner} ${cell.column}`);
    expect(cell.value, `${cell.owner} ${cell.column}`).toEqual(field(row));
    const text = shownText(cell.column, cell.value);
    if (text !== null) expect(cell.text, `${cell.owner} ${cell.column} text`).toBe(text);
  }
}

const EXPLORE_COLS = 'total,pac,small,coverage,industries,missed,eligible,dim1,tenure,kept,rated';

async function checkExplore(page: Page): Promise<Row[]> {
  await page.goto(
    `${stack.baseUrl}/explore?scope=all&sort=total.desc&cols=${EXPLORE_COLS}&size=100`,
  );
  const table = await agreed<{ rows: Row[]; total: number }>('explore.table', {
    filters: { scope: 'all' },
    sort: [{ column: 'totalReceiptsCents', direction: 'desc' }],
    limit: 100,
    offset: 0,
  });
  const shown = await page
    .locator('tbody tr[data-slug]')
    .evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-slug')));
  expect(shown).toEqual(table.rows.map((r) => r.slug));
  const names = await page.locator('tbody tr[data-slug] th a').allInnerTexts();
  expect(names).toEqual(table.rows.map((r) => r.fullName));
  await expect(page.locator('p[aria-live="polite"]')).toContainText(
    `${table.total.toLocaleString('en-US')} current and former members`,
  );
  const found = await cells(page, 'tbody tr[data-slug] td[data-column]');
  expect(new Set(found.map((c) => c.column))).toEqual(
    new Set(['total', 'pac', 'missed', ...found.map((c) => c.column)]),
  );
  expectCellsMatch(found, table.rows);
  return table.rows;
}

async function checkProfile(page: Page, slug: string): Promise<Json> {
  await page.goto(`${stack.baseUrl}/people/${slug}`);
  const profile = await agreed<{ person: { fullName: string }; card: Json }>('people.get', {
    slug,
  });
  const money = await agreed<{ totals: Json | null }>('money.summary', { slug });
  const votes = await agreed<{
    items: Array<{
      position: string | null;
      tally: { yea: number; nay: number };
      rollcall: Json;
    }>;
  }>('votes.list', { slug, limit: 20, offset: 0 });

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    new RegExp(`^${profile.person.fullName}`),
  );
  for (const [field, format] of [
    ['totalReceiptsCents', (v: number) => formatCents(v, { compact: true })],
    ['pacShare', formatShare],
    ['smallDollarShare', formatShare],
    ['missedVoteRate', formatShare],
  ] as const) {
    const fact = page.locator(`[data-fact="${field}"]`);
    const raw = JSON.parse((await fact.getAttribute('data-value')) ?? 'undefined');
    expect(raw, field).toEqual(profile.card[field]);
    const text = raw === null ? null : format(raw as number);
    if (text) await expect(fact.locator('dd'), field).toHaveText(text);
  }

  if (money.totals) {
    for (const [stat, field] of [
      ['raised', 'totalReceiptsCents'],
      ['Spent', 'totalDisbursementsCents'],
      ['Cash on hand', 'cashOnHandCents'],
      ['Debts', 'debtsCents'],
    ] as const) {
      const box = page.locator(`[data-stat="${stat}"]`);
      await expect(box).toBeVisible();
      const raw = JSON.parse((await box.getAttribute('data-value')) ?? 'undefined');
      expect(raw, stat).toEqual(money.totals[field]);
      const text = formatCents(raw as number | null);
      if (text) await expect(box.locator('dd'), stat).toContainText(text);
    }
  }

  const rows = page.locator('#votes tr[data-rollcall]');
  await expect(rows).toHaveCount(votes.items.length);
  const shown = await rows.evaluateAll((trs) =>
    trs.map((tr) => JSON.parse(tr.getAttribute('data-value') ?? 'null')),
  );
  expect(shown).toEqual(votes.items.map((v) => [v.position, v.tally.yea, v.tally.nay]));
  return profile.card;
}

async function checkCompare(page: Page, slugs: string[]) {
  await page.goto(`${stack.baseUrl}/compare?ids=${slugs.join(',')}`);
  const comparison = await agreed<{
    people: Row[];
    voteAgreement: Array<{
      a: string;
      b: string;
      agreed: number;
      sharedVotes: number;
      rate: unknown;
    }>;
  }>('people.compare', { slugs });
  const found = await cells(page, 'td[data-slug][data-column]');
  expect(new Set(found.map((c) => c.owner))).toEqual(new Set(slugs));
  expectCellsMatch(found, comparison.people);
  const pairs = await page
    .locator('li[data-pair]')
    .evaluateAll((lis) =>
      lis.map((li) => [
        li.getAttribute('data-pair'),
        JSON.parse(li.getAttribute('data-value') ?? 'null'),
      ]),
    );
  expect(pairs).toEqual(
    comparison.voteAgreement.map((p) => [`${p.a},${p.b}`, [p.agreed, p.sharedVotes, p.rate]]),
  );
}

async function checkFramework(page: Page) {
  const list = await agreed<{ items: Array<{ slug: string; spec: Json }> }>('frameworks.list', {});
  const framework = list.items[0];
  if (!framework) throw new Error('seed has no framework');
  await page.goto(`${stack.baseUrl}/frameworks?f=${framework.slug}`);
  const evaluation = await agreed<{
    results: Array<{
      person: { slug: string };
      aligned: number;
      considered: number;
      notCounted: number;
      alignmentRate: unknown;
    }>;
  }>('frameworks.evaluate', { framework: framework.spec, people: {}, limit: 50, offset: 0 });
  expect(evaluation.results.length).toBeGreaterThan(0);
  const rows = page.locator('tr[data-slug][data-value]');
  const shown = await rows.evaluateAll((trs) =>
    trs.map((tr) => [
      tr.getAttribute('data-slug'),
      JSON.parse(tr.getAttribute('data-value') ?? 'null'),
    ]),
  );
  expect(shown).toEqual(
    evaluation.results.map((r) => [
      r.person.slug,
      [r.aligned, r.considered, r.notCounted, r.alignmentRate],
    ]),
  );
  const first = evaluation.results[0];
  if (first) {
    await expect(rows.first().locator('td').first()).toContainText(
      `${first.aligned} of ${first.considered}`,
    );
  }
}

/** A member with money and votes, so profile and compare checks are not vacuous. */
function pickSubjects(rows: Row[]): string[] {
  const full = rows.filter((r) => r.totalReceiptsCents !== null && r.missedVoteRate !== null);
  expect(full.length).toBeGreaterThanOrEqual(3);
  return full.slice(0, 3).map((r) => r.slug);
}

const RENAMED = 'Renamed Member Shared-State';
const ADDED_CENTS = 123_456_700;
let subjects: string[] = [];
let before: Json = {};

test('pages show the values the API and the MCP server return for the same input', async ({
  page,
}) => {
  const rows = await checkExplore(page);
  subjects = pickSubjects(rows);
  before = await checkProfile(page, subjects[0] ?? '');
  await checkCompare(page, subjects);
  await checkFramework(page);
});

test('remaining profile sections show populated and missing values through UI, HTTP and MCP', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const populated = await checkSupplementalProfile(page, stack.baseUrl, agreed, 'avery-ashvale');
  expect(populated.scores.ideology.length).toBeGreaterThan(0);
  expect(populated.scores.scorecards.length).toBeGreaterThan(0);
  expect(populated.scores.linkOnlyPublishers.length).toBeGreaterThan(0);
  expect(populated.promises.items.length).toBeGreaterThan(0);
  expect(populated.profile.platform.length).toBeGreaterThan(0);
  expect(populated.profile.candidacies.length).toBeGreaterThan(0);
  expect(populated.money.industries.length).toBeGreaterThan(0);
  expect(populated.money.outsideSpending.itemCount).toBeGreaterThan(0);
  const scoreless = await checkSupplementalProfile(
    page,
    stack.baseUrl,
    agreed,
    'emerson-elderquay',
  );
  expect(scoreless.scores.scorecards).toEqual([]);
  const emptyFigures = await checkSupplementalProfile(
    page,
    stack.baseUrl,
    agreed,
    'blair-brindlemoor',
  );
  expect(emptyFigures.money.totals).not.toBeNull();
  expect(emptyFigures.money.industryCoding.grossCents).toBe(0);
  expect(emptyFigures.money.outsideSpending.itemCount).toBe(0);
  const rows = await agreed<CapabilityOutput<'explore.table'>>('explore.table', {
    filters: { scope: 'all' },
    limit: 100,
  });
  const missing = rows.rows.find((r) => r.isCurrent && r.totalReceiptsCents === null);
  const former = rows.rows.find((r) => !r.isCurrent);
  if (!missing || !former) throw new Error('seed must include missing-money and former members');
  const sparse = await checkSupplementalProfile(page, stack.baseUrl, agreed, missing.slug);
  expect(sparse.promises.summary.total).toBe(0);
  expect(sparse.profile.platform).toEqual([]);
  expect(sparse.money.totals).toBeNull();
  expect(sparse.money.industryCoding.grossCents).toBe(0);
  expect(sparse.money.outsideSpending.itemCount).toBe(0);
  const historical = await checkSupplementalProfile(page, stack.baseUrl, agreed, former.slug);
  expect(historical.scores.ideology).toEqual([]);
  expect(historical.profile.candidacies).toEqual([]);
});

test('Home, Policy index and chamber matrices, and Sources show HTTP and MCP values', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await checkHome(page, stack.baseUrl, agreed);
  await checkPolicy(page, stack.baseUrl, agreed);
  await checkSources(page, stack.baseUrl, agreed);
});

test('actual ingest publication survives web, MCP and Postgres process restarts with unchanged values', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const slug = 'avery-ashvale';
  const previous = await agreed<CapabilityOutput<'promises.list'>>('promises.list', { slug });
  const beforeStatus = await agreed<CapabilityOutput<'sources.status'>>('sources.status', {});
  const snapshot = fileURLToPath(new URL('./fixtures/curated', import.meta.url));
  const receipt = stack.ingestCurated(snapshot);
  expect(receipt.status).toBe('succeeded');
  expect(receipt.operation).toBe('ingest.run');
  expect(receipt.actor).toBe('operator');
  expect(receipt.source).toBe('curated');
  expect(receipt.counts).toMatchObject({ promises: 2, promise_ratings: 1, platform_positions: 2 });
  const loaded = await checkSupplementalProfile(page, stack.baseUrl, agreed, slug);
  const glance = await agreed<CapabilityOutput<'people.glance'>>('people.glance', { slug });
  expect(glance.facts.say.promises).toBe(loaded.promises.summary.total);
  expect(glance.facts.say.promisesKept).toBe(loaded.promises.summary.kept);
  await page.goto(`${stack.baseUrl}/people/${slug}`);
  for (const paragraph of glance.paragraphs) {
    for (const sentence of paragraph.sentences) {
      await expect(
        page.locator(`#glance [data-sentence="${sentence.id}"] [data-sentence-text]`),
      ).toHaveText(sentence.text);
    }
  }
  expect(loaded.promises.summary.total).toBe(previous.summary.total + 2);
  const publishedRows = await checkExplore(page);
  const publishedCard = publishedRows.find((row) => row.slug === slug);
  expect(publishedCard?.promiseKeptRate).toBe(loaded.promises.summary.keptRate);
  expect(publishedCard?.promisesRated).toBe(loaded.promises.summary.rated);
  await checkCompare(page, [slug, 'blair-brindlemoor']);
  const promise = loaded.promises.items.find(
    (p) => p.promiseKey === 'X000001:parity-restart-clinic',
  );
  expect(promise).toMatchObject({
    statement: 'Publish fictional clinic opening hours every month.',
    status: 'kept',
    provenance: { sourceId: 'curated', ingestRunId: receipt.runId },
  });
  expect(
    loaded.promises.items.find((p) => p.promiseKey === 'X000001:parity-restart-unrated')?.status,
  ).toBe('not_yet_rated');
  const status = await checkSources(page, stack.baseUrl, agreed);
  expect(status.readModelRefreshedAt).not.toBe(beforeStatus.readModelRefreshedAt);
  expect(status.sources.find((s) => s.id === 'curated')?.lastRun).toMatchObject({
    id: receipt.runId,
    status: 'succeeded',
    counts: receipt.counts,
  });
  await checkHome(page, stack.baseUrl, agreed);
  const duplicate = stack.ingestCurated(snapshot);
  expect(duplicate).toMatchObject({ runId: receipt.runId, deduplicated: true });
  await stack.stopWeb();
  await stack.stopMcp();
  const restart = await stack.restartDatabase();
  expect(restart.beforePid).not.toBe(restart.afterPid);
  await stack.startWeb();
  await stack.startMcp();
  const restarted = await checkSupplementalProfile(page, stack.baseUrl, agreed, slug);
  expect(restarted).toEqual(loaded);
  expect(await agreed<CapabilityOutput<'people.glance'>>('people.glance', { slug })).toEqual(
    glance,
  );
  expect(await checkExplore(page)).toEqual(publishedRows);
  await checkCompare(page, [slug, 'blair-brindlemoor']);
  const restartedStatus = await checkSources(page, stack.baseUrl, agreed);
  expect(restartedStatus).toEqual(status);
  await checkHome(page, stack.baseUrl, agreed);
  const evidencePath = testInfo.outputPath('ingest-and-restart.json');
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        receipt,
        duplicate,
        restart,
        promise,
        status,
        publishedRows,
        loaded,
        glance,
        unchangedAfterRestart: true,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('ingest-and-restart.json', {
    contentType: 'application/json',
    path: evidencePath,
  });
});

test('a data change plus read-model refresh reaches the UI, the API and MCP alike', async ({
  page,
}) => {
  const slug = subjects[0] ?? '';
  stack.changeData(slug, RENAMED, ADDED_CENTS);
  const card = await checkProfile(page, slug);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^${RENAMED}`));
  expect(card.totalReceiptsCents).toBe((before.totalReceiptsCents as number) + ADDED_CENTS);
  expect(card.refreshedAt).not.toBe(before.refreshedAt);
  const rows = await checkExplore(page);
  expect(rows.find((r) => r.slug === slug)?.fullName).toBe(RENAMED);
  await checkCompare(page, subjects);
});

test('after restarting the web and MCP processes all three still agree', async ({ page }) => {
  await stack.stopWeb();
  await stack.stopMcp();
  await stack.startWeb();
  await stack.startMcp();
  const slug = subjects[0] ?? '';
  const card = await checkProfile(page, slug);
  expect(card.totalReceiptsCents).toBe((before.totalReceiptsCents as number) + ADDED_CENTS);
  const rows = await checkExplore(page);
  expect(rows.find((r) => r.slug === slug)?.fullName).toBe(RENAMED);
  await checkCompare(page, subjects);
  await checkFramework(page);
});

test('a production web server without the read-only role refuses to start', async () => {
  const refused = await stack.webExit({ DATABASE_URL: stack.ownerUrl });
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain('refusing to start: database configuration');
  expect(refused.stderr).toContain('DATABASE_URL_READONLY is not set');
  expect(refused.stderr).not.toContain('postgres:postgres@');
});
