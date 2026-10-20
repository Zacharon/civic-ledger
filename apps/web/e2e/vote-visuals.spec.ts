import AxeBuilder from '@axe-core/playwright';
import type { CapabilityOutput } from '@civic-ledger/core';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { monthLabel } from '../src/lib/attendance';

/**
 * Vote visuals: how each party voted, attendance by month, and the chamber seat chart.
 * Every number on screen is compared with the same capability read over /api/v1 (the MCP
 * parity of these capabilities is covered by test/parity.test.ts). Seed facts used here
 * are fictional: Jules Kindlewood is sworn in on 2025-06-10, and the House holds no
 * roll call in June, July or December of 2025.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MID = 'jules-kindlewood';

async function api<T>(request: APIRequestContext, name: string, input: object) {
  const response = await request.get(
    `/api/v1/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,
  );
  expect(response.status(), name).toBe(200);
  return (await response.json()) as T;
}

async function openAll(page: Page) {
  // Native <details> are closed by default on phones; open every one for the axe pass.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.setAttribute('open', '');
  });
}

async function violations(page: Page) {
  await page.waitForLoadState('networkidle');
  await openAll(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map(
    (v) =>
      `${v.id}: ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

async function profile(page: Page, slug: string) {
  await page.goto(`/people/${slug}`);
  await expect(page.locator('#votes[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('#votes [data-attendance]')).toBeVisible();
}

const PAGES = ['/', '/policy/health', '/people/avery-ashvale', `/people/${MID}`];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`vote visuals axe (${colorScheme})`, () => {
    test.use({ colorScheme });
    for (const path of PAGES) {
      test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.goto(path);
        if (path.startsWith('/people/')) {
          await expect(page.locator('#votes[aria-busy="true"]')).toHaveCount(0);
        }
        expect(await violations(page)).toEqual([]);
      });
    }
  });
}

test.describe('vote visuals on a phone (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of PAGES) {
    test(`${path} has no violations and no sideways page scroll`, async ({ page }) => {
      await page.goto(path);
      if (path.startsWith('/people/')) {
        await expect(page.locator('#votes[aria-busy="true"]')).toHaveCount(0);
      }
      expect(await violations(page)).toEqual([]);
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
    });
  }

  test('the party breakdown folds on phones and opens from the keyboard', async ({ page }) => {
    await page.goto('/policy/health');
    const first = page.locator('[data-party-breakdown]').first();
    const details = first.locator('details');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(first.locator('table')).toBeHidden();
    const summary = details.locator('summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(first.locator('table')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(first.locator('table')).toBeHidden();
  });

  test('the seat chart keeps labels and counts on a phone', async ({ page }) => {
    await page.goto('/');
    const house = page.locator('figure[data-chamber="house"]');
    await house.scrollIntoViewIfNeeded();
    await expect(house.locator('li[data-party]').first()).toBeVisible();
    await expect(house).toContainText('voting seats filled');
    const box = await house.locator('.seat-grid').first().boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(390);
    const square = await house.locator('.seat').first().boundingBox();
    expect(square?.width ?? 0).toBeGreaterThanOrEqual(8);
  });
});

test.describe('how each party voted', () => {
  test('rows add up to the roll-call total, in vote colors, parties as text', async ({
    page,
    request,
  }) => {
    await page.goto('/policy/health?chamber=senate');
    const votes = await api<CapabilityOutput<'votes.list'>>(request, 'votes.list', {
      policyArea: 'health',
      chamber: 'senate',
      limit: 10,
    });
    const items = page.locator('li[data-rollcall]');
    await expect(items).toHaveCount(votes.items.length);
    for (const [i, vote] of votes.items.entries()) {
      const block = items.nth(i).locator('[data-party-breakdown]');
      await expect(block).toHaveAttribute('data-reconciles', 'true');
      const total = vote.tally.yea + vote.tally.nay + vote.tally.present + vote.tally.notVoting;
      await expect(block).toHaveAttribute('data-total', String(total));
      expect(vote.byParty.length).toBeGreaterThanOrEqual(2);
      // One row per party present, alphabetical, with the four positions kept apart.
      const names = await block
        .locator('tbody th')
        .evaluateAll((n) => n.map((x) => x.querySelector('.font-medium')?.textContent ?? ''));
      expect(names).toEqual(vote.byParty.map((p) => p.party));
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      const rows = await block
        .locator('tbody tr')
        .evaluateAll((trs) =>
          trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => Number(td.textContent))),
        );
      expect(rows).toEqual(vote.byParty.map((p) => [p.yea, p.nay, p.present, p.notVoting]));
      const sums = [0, 1, 2, 3].map((c) => rows.reduce((n, r) => n + (r[c] ?? 0), 0));
      expect(sums).toEqual([
        vote.tally.yea,
        vote.tally.nay,
        vote.tally.present,
        vote.tally.notVoting,
      ]);
      const footer = await block.locator('tfoot td').allTextContents();
      expect(footer.map(Number)).toEqual(sums);
      // Segments are drawn with vote classes only; party names are plain text.
      const classes = await block
        .locator('.vote-meter > span')
        .evaluateAll((spans) => spans.map((s) => s.className));
      expect(classes.length).toBeGreaterThan(0);
      for (const c of classes) expect(c).toMatch(/^vote-(yea|nay|present|not-voting)$/);
      await expect(block.locator('.chip')).toHaveCount(0);
      await expect(block).toContainText('each member’s party on the vote date');
    }
  });

  test('segments use the vote tokens, never a party color', async ({ page }) => {
    await page.goto('/policy/health');
    const fills = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (token: string) => {
        const h = css.getPropertyValue(token).trim();
        return `rgb(${[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      };
      const party = [rgb('--party-dem-ink'), rgb('--party-rep-ink')];
      const colors = [
        ...document.querySelectorAll('[data-party-breakdown] .vote-meter > span'),
      ].map((el) => getComputedStyle(el).backgroundColor);
      return { colors, party, yea: rgb('--vote-yea'), nay: rgb('--vote-nay') };
    });
    expect(fills.colors.length).toBeGreaterThan(0);
    for (const c of fills.colors) expect(fills.party).not.toContain(c);
    expect(fills.colors).toContain(fills.yea);
    expect(fills.colors).toContain(fills.nay);
  });

  test('a member profile row folds its breakdown and matches the roll call', async ({
    page,
    request,
  }) => {
    await profile(page, 'avery-ashvale');
    const first = page.locator('#votes tr[data-rollcall]').first();
    const block = first.locator('[data-party-breakdown]');
    await expect(block.locator('table')).toBeHidden();
    await block.locator('summary').press('Enter');
    await expect(block.locator('table')).toBeVisible();
    const votes = await api<CapabilityOutput<'votes.list'>>(request, 'votes.list', {
      slug: 'avery-ashvale',
      limit: 1,
    });
    const item = votes.items[0];
    if (!item) throw new Error('seed member has no votes');
    const rows = await block
      .locator('tbody tr')
      .evaluateAll((trs) =>
        trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => Number(td.textContent))),
      );
    expect(rows).toEqual(item.byParty.map((p) => [p.yea, p.nay, p.present, p.notVoting]));
  });
});

test.describe('attendance by month', () => {
  test('a member who started mid-Congress: months, denominators and totals agree with the API', async ({
    page,
    request,
  }) => {
    await profile(page, MID);
    const attendance = await api<CapabilityOutput<'votes.attendance'>>(
      request,
      'votes.attendance',
      {
        slug: MID,
      },
    );
    const card = (await api<CapabilityOutput<'people.get'>>(request, 'people.get', { slug: MID }))
      .card;
    // The strip's totals are the profile's own missed-vote figures.
    expect(attendance.totals.eligible).toBe(card.votesEligible);
    expect(attendance.totals.missedRate).toBe(card.missedVoteRate);
    const strip = page.locator('#votes [data-attendance]');
    expect(JSON.parse((await strip.getAttribute('data-value')) ?? 'null')).toEqual([
      attendance.totals.eligible,
      attendance.totals.missed,
      attendance.totals.present,
    ]);
    await expect(page.locator('#votes [data-attendance-summary]')).toContainText(
      `${attendance.totals.missed} of ${attendance.totals.eligible} eligible votes`,
    );

    const cells = strip.locator('li[data-month-cell]');
    await expect(cells).toHaveCount(attendance.months.length);
    for (const m of attendance.months) {
      const cell = strip.locator(`li[data-month-cell="${m.month}"]`);
      await expect(cell).toHaveAttribute('data-status', m.status);
      if (m.status === 'served') {
        await expect(cell).toContainText(`Of ${m.eligible} eligible`);
        await expect(cell).toContainText(`${m.missed} not voting`);
        await expect(cell).toContainText(`${m.present} present`);
        await expect(cell).not.toHaveClass(/attend-cell-(none|away)/);
      }
    }

    // Months before service, months without votes, and a zero-miss month read differently.
    const status = Object.fromEntries(attendance.months.map((m) => [m.month, m.status]));
    expect(status['2025-01']).toBe('not_yet_serving');
    expect(status['2025-02']).toBe('not_yet_serving');
    expect(status['2025-06']).toBe('no_votes_held');
    expect(status['2025-12']).toBe('no_votes_held');
    const notYet = strip.locator('li[data-month-cell="2025-02"]');
    await expect(notYet).toContainText('Not yet serving');
    await expect(notYet).toHaveClass(/attend-cell-away/);
    const noVotes = strip.locator('li[data-month-cell="2025-06"]');
    await expect(noVotes).toContainText('No votes held');
    await expect(noVotes).toHaveClass(/attend-cell-none/);
    await expect(noVotes).not.toContainText('0 not voting');
    const zero = attendance.months.find((m) => m.status === 'served' && m.missed === 0);
    if (zero) {
      const cell = strip.locator(`li[data-month-cell="${zero.month}"]`);
      await expect(cell).toContainText('0 not voting');
      await expect(cell).not.toHaveClass(/attend-cell-none/);
    }
    // Screen readers get a full sentence per month, not colors.
    await expect(noVotes.locator('.sr-only')).toContainText(
      `No votes held in ${monthLabel('2025-06')}`,
    );
  });

  test('the table twin is keyboard reachable and carries the same numbers', async ({
    page,
    request,
  }) => {
    await profile(page, MID);
    const attendance = await api<CapabilityOutput<'votes.attendance'>>(
      request,
      'votes.attendance',
      {
        slug: MID,
      },
    );
    const summary = page.locator('#votes [data-attendance] summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    const table = page.locator('#votes [data-attendance] table');
    await expect(table).toBeVisible();
    const rows = await table
      .locator('tbody tr')
      .evaluateAll((trs) =>
        trs.map((tr) => [
          tr.getAttribute('data-month'),
          JSON.parse(tr.getAttribute('data-value') ?? 'null'),
        ]),
      );
    expect(rows).toEqual(
      attendance.months.map((m) => [m.month, [m.status, m.eligible, m.missed, m.present]]),
    );
    const footer = (await table.locator('tfoot td').allTextContents()).slice(0, 3);
    expect(footer.map((t) => Number(t.replaceAll(',', '')))).toEqual([
      attendance.totals.eligible,
      attendance.totals.missed,
      attendance.totals.present,
    ]);
    // The scroll region around the table is itself focusable.
    await expect(page.getByRole('region', { name: 'Attendance by month table' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  test('uses neutral greys: no red or blue and no Yea or Nay color in the strip', async ({
    page,
  }) => {
    await profile(page, MID);
    const colors = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (token: string) => {
        const h = css.getPropertyValue(token).trim();
        return `rgb(${[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      };
      const used = new Set<string>();
      for (const el of document.querySelectorAll('[data-attendance] *')) {
        const s = getComputedStyle(el);
        used.add(s.backgroundColor);
        // A border color only paints when the border has width (it defaults to currentColor).
        if (Number.parseFloat(s.borderTopWidth) > 0) used.add(s.borderTopColor);
      }
      return {
        used: [...used],
        forbidden: [
          rgb('--vote-yea'),
          rgb('--vote-nay'),
          rgb('--party-dem-ink'),
          rgb('--party-rep-ink'),
          rgb('--party-dem-bg'),
          rgb('--party-rep-bg'),
        ],
      };
    });
    for (const c of colors.forbidden) expect(colors.used).not.toContain(c);
  });
});

test.describe('chamber seat chart', () => {
  test('counts, order, labels and provenance come from chamber.composition', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const composition = await api<CapabilityOutput<'chamber.composition'>>(
      request,
      'chamber.composition',
      {},
    );
    await expect(page.locator('[data-seat-order]')).toContainText(
      'Democrat, Independent, Republican',
    );
    await expect(page.locator('[data-seat-order]')).toContainText('not a ranking');
    for (const block of composition.chambers) {
      const figure = page.locator(`figure[data-chamber="${block.chamber}"]`);
      expect(JSON.parse((await figure.getAttribute('data-value')) ?? 'null')).toEqual([
        block.seats,
        block.members,
        block.voting.map((p) => [p.party, p.count]),
        block.nonVoting.total,
        block.vacancies,
      ]);
      // Every party's name and count is printed, in the capability's order.
      const legend = await figure
        .locator('li[data-party]')
        .first()
        .locator('xpath=..')
        .locator('li')
        .evaluateAll((lis) =>
          lis.map((li) => [
            li.getAttribute('data-party'),
            Number(li.querySelector('.num')?.textContent),
          ]),
        );
      expect(legend).toEqual(block.voting.map((p) => [p.party, p.count]));
      // One square per member; hollow squares only for known vacancies.
      const grid = figure.locator('.seat-grid').first();
      await expect(grid.locator('span.seat')).toHaveCount(block.members + (block.vacancies ?? 0));
      await expect(grid.locator('span.seat-vacant')).toHaveCount(block.vacancies ?? 0);
      await expect(grid).toHaveAttribute('role', 'img');
      const label = (await grid.getAttribute('aria-label')) ?? '';
      expect(label).toContain(`${block.members} of ${block.seats} voting seats filled`);
      for (const p of block.voting) expect(label).toContain(`${p.count} ${p.party}`);
      if (block.vacancies === null) {
        await expect(figure.locator('[data-vacancies="unknown"]')).toContainText(
          'Vacancies are not shown',
        );
      }
    }
    // Non-voting members are counted apart from the House's voting seats.
    const house = page.locator('figure[data-chamber="house"]');
    await expect(house.locator('[data-nonvoting]')).toHaveAttribute(
      'data-nonvoting',
      String(composition.chambers[0]?.nonVoting.total),
    );
    await expect(page.locator('#seats-title').locator('xpath=ancestor::section[1]')).toContainText(
      'Sources',
    );
  });

  test('only Democrat and Republican squares take party color; others are neutral', async ({
    page,
  }) => {
    await page.goto('/');
    const found = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (token: string) => {
        const h = css.getPropertyValue(token).trim();
        return `rgb(${[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      };
      const parties = [rgb('--party-dem-ink'), rgb('--party-rep-ink')];
      const votes = [rgb('--vote-yea'), rgb('--vote-nay'), rgb('--vote-not-voting')];
      const out: { cls: string; color: string }[] = [];
      for (const el of document.querySelectorAll('.seat-grid .seat')) {
        out.push({ cls: el.className, color: getComputedStyle(el).backgroundColor });
      }
      return { out, parties, votes };
    });
    expect(found.out.length).toBeGreaterThan(0);
    for (const { cls, color } of found.out) {
      expect(found.votes, cls).not.toContain(color);
      // The seeded parties are fictional (neutral); a muted party tint would only ever
      // appear on a democratic or republican square.
      if (!/seat-(democratic|republican)/.test(cls))
        expect(found.parties, cls).not.toContain(color);
    }
  });

  test('respects reduced motion (nothing animates)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const motion = await page.evaluate(() =>
      [...document.querySelectorAll('.seat-grid, .seat-grid *, [data-attendance] *')].some((el) =>
        getComputedStyle(el)
          .transitionDuration.split(',')
          .some((d) => parseFloat(d) > 0),
      ),
    );
    expect(motion).toBe(false);
  });
});
