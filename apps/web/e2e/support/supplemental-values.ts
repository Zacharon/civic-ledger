import type { CapabilityOutput } from '@civic-ledger/core';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  formatCents,
  formatDate,
  formatNumber,
  formatScore,
  formatShare,
  formatSigned,
  ordinal,
  seatLabel,
} from '../../src/lib/format';

type Json = Record<string, unknown>;
export type Agreed = <T>(name: string, input: Json) => Promise<T>;

/** Raw observations are compared with independently selected business fields below. */
async function raw(locator: Locator) {
  return JSON.parse((await locator.getAttribute('data-value')) ?? 'undefined') as unknown;
}
async function keyed(locator: Locator, key: string) {
  return locator.evaluateAll(
    (nodes, attribute) =>
      nodes.map((node) => [
        node.getAttribute(attribute),
        JSON.parse(node.getAttribute('data-value') ?? 'undefined') as unknown,
      ]),
    key,
  );
}
async function text(locator: Locator, expected: string | number | null) {
  expect(expected, 'test must have an expected display value').not.toBeNull();
  await expect(locator).toContainText(String(expected), { useInnerText: true });
}
const STATUS = {
  kept: 'Kept',
  compromise: 'Compromise',
  broken: 'Broken',
  in_progress: 'In progress',
  stalled: 'Stalled',
  not_yet_rated: 'Not yet rated',
} as const;

export async function checkSupplementalProfile(
  page: Page,
  baseUrl: string,
  agreed: Agreed,
  slug: string,
) {
  await page.goto(`${baseUrl}/people/${slug}`);
  const profile = await agreed<CapabilityOutput<'people.get'>>('people.get', { slug });
  const scores = await agreed<CapabilityOutput<'scores.list'>>('scores.list', { slug });
  const promises = await agreed<CapabilityOutput<'promises.list'>>('promises.list', { slug });
  const money = await agreed<CapabilityOutput<'money.summary'>>('money.summary', { slug });

  const latest = scores.ideology[0];
  const ideology = page.locator('#scores [data-ideology]');
  expect(await raw(ideology)).toEqual(latest ? [latest.congress, latest.dim1, latest.dim2] : null);
  if (latest) {
    await text(ideology, formatSigned(latest.dim1));
    if (latest.dim2 !== null) await text(ideology, formatSigned(latest.dim2));
    await text(page.locator('#scores'), `${ordinal(latest.congress)} Congress`);
    if (profile.card.chamber) {
      const peers = await agreed<CapabilityOutput<'explore.table'>>('explore.table', {
        filters: { chamber: profile.card.chamber },
        limit: 100,
      });
      expect(peers.total, 'the complete fictional peer set fits one page').toBeLessThanOrEqual(100);
      const cohort = peers.rows.filter(
        (r) => r.dwNominateDim1 !== null && r.ideologyCongress === latest.congress,
      );
      if (cohort.length > 1) {
        const lower = cohort.filter((r) => (r.dwNominateDim1 ?? 0) < latest.dim1).length;
        await expect(page.locator('#scores svg[role="img"]')).toHaveAttribute(
          'aria-label',
          `${profile.person.fullName}'s first-dimension score is ${formatSigned(latest.dim1)}. ${lower} of ${cohort.length} ${profile.card.chamber === 'senate' ? 'Senate' : 'House'} members with a score are further toward the liberal end of the scale.`,
        );
      }
    }
  } else await text(ideology, 'No DW-NOMINATE estimate yet');
  const history = page.locator('#scores [data-ideology-congress]');
  expect(await keyed(history, 'data-ideology-congress')).toEqual(
    scores.ideology.length > 1
      ? scores.ideology.map((s) => [`${s.method}:${s.congress}`, [s.dim1, s.dim2]])
      : [],
  );
  for (const score of scores.ideology.length > 1 ? scores.ideology : []) {
    // The exact selector avoids deriving expectations from the UI's attributes.
    const cells = page.locator(`[data-ideology-congress="${score.method}:${score.congress}"] td`);
    await expect(cells.nth(0)).toHaveText(formatSigned(score.dim1) ?? '—');
    await expect(cells.nth(1)).toHaveText(formatSigned(score.dim2) ?? '—');
  }
  const groups = [...new Set(scores.scorecards.map((s) => s.publisher.id))].map((id) =>
    scores.scorecards.filter((s) => s.publisher.id === id).sort((a, b) => b.year - a.year),
  );
  const shownCards = page.locator('#scores [data-scorecard]');
  await expect(shownCards).toHaveCount(groups.length);
  for (const group of groups) {
    const first = group[0];
    if (!first) throw new Error('empty scorecard test group');
    const card = page.locator(`#scores [data-scorecard="${first.publisher.id}"]`);
    expect(await raw(card)).toEqual([first.year, first.score, first.scale.min, first.scale.max]);
    await text(card.locator('div').first(), first.publisher.name);
    await text(
      card.locator('div').first(),
      `${formatScore(first.score)} / ${formatScore(first.scale.max)}`,
    );
    await text(card, first.publisher.selfDescribedOrientation);
    await text(
      card,
      `${formatScore(first.scale.min)}–${formatScore(first.scale.max)} (${first.scale.label})`,
    );
    await expect(card.getByRole('link', { name: 'Methodology', exact: true })).toHaveAttribute(
      'href',
      first.methodologyUrl,
    );
    for (const earlier of group.slice(1))
      await text(card, `${earlier.year} ${formatScore(earlier.score)}`);
  }
  if (groups.length === 0)
    await text(page.locator('#scores'), 'No cleared scorecard has scored this member');
  const linkOnly = page.locator('#scores [data-link-only]');
  expect(
    await linkOnly.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-link-only'))),
  ).toEqual(scores.linkOnlyPublishers.map((p) => p.id));
  for (const publisher of scores.linkOnlyPublishers) {
    const item = page.locator(`#scores [data-link-only="${publisher.id}"]`);
    await text(item, publisher.name);
    await text(item, publisher.selfDescribedOrientation);
    await expect(item.locator('a')).toHaveAttribute('href', publisher.url);
  }

  const summary = promises.summary;
  const summaryNode = page.locator('#promises [data-promises]');
  expect(await raw(summaryNode)).toEqual([
    summary.total,
    summary.rated,
    summary.kept,
    summary.keptRate,
  ]);
  await text(
    summaryNode,
    summary.total === 0
      ? 'No campaign promises have been curated'
      : `${summary.kept} of ${summary.rated}`,
  );
  if (summary.total > 0) {
    await text(summaryNode, `${summary.total - summary.rated} still open or unrated`);
    if (summary.keptRate !== null) await text(summaryNode, formatShare(summary.keptRate));
  }
  const promiseRows = page.locator('#promises [data-promise]');
  expect(await keyed(promiseRows, 'data-promise')).toEqual(
    promises.items.map((p) => [
      p.promiseKey,
      [p.status, p.policyArea?.id ?? null, p.madeOn, p.ratings.map((r) => r.status)],
    ]),
  );
  for (const p of promises.items) {
    const item = page.locator(`#promises [data-promise="${p.promiseKey}"]`);
    await text(item.locator('blockquote'), p.statement);
    await text(item.locator('div').nth(1), STATUS[p.status]);
    if (p.madeOn) await text(item, formatDate(p.madeOn));
    if (p.policyArea) await text(item, p.policyArea.name);
    await expect(item.getByRole('link', { name: 'Where it was said' })).toHaveAttribute(
      'href',
      p.sourceUrl,
    );
    for (const rating of p.ratings) {
      await text(
        item,
        `${STATUS[rating.status]}, rated by ${rating.rater} on ${formatDate(rating.ratedOn)}`,
      );
      for (const evidence of rating.evidence)
        await expect(item.getByRole('link', { name: evidence.title, exact: true })).toHaveAttribute(
          'href',
          evidence.url,
        );
    }
  }

  const platforms = page.locator('#platform [data-platform]');
  if (profile.platform.length === 0) {
    expect(await raw(platforms)).toEqual([]);
    await text(platforms, 'No stated platform positions have been curated');
  } else {
    await expect(platforms).toHaveCount(profile.platform.length);
    for (const p of profile.platform) {
      const votes = await agreed<CapabilityOutput<'votes.list'>>('votes.list', {
        slug,
        policyArea: p.policyArea.id,
        limit: 4,
      });
      const item = page.locator(`#platform [data-platform="${p.cycle}:${p.policyArea.id}"]`);
      expect(await raw(item)).toEqual([p.stance, votes.items.map((v) => v.position), votes.total]);
      await text(item, p.policyArea.name);
      await text(item, `${p.cycle} campaign`);
      await text(item.locator('p').first(), p.stance);
      await expect(
        item.getByRole('link', { name: 'Campaign source', exact: true }),
      ).toHaveAttribute('href', p.sourceUrl);
      const voteRows = item.locator('ul > li').filter({ has: page.locator('span.w-20') });
      await expect(voteRows).toHaveCount(votes.items.length);
      for (const [i, vote] of votes.items.entries()) {
        const labels = { yea: 'Yea', nay: 'Nay', present: 'Present', not_voting: 'Not voting' };
        await text(voteRows.nth(i), vote.position ? labels[vote.position] : 'No record');
        await text(voteRows.nth(i), vote.bill?.title ?? vote.rollcall.question);
      }
      if (votes.items.length === 0) await text(item, `No roll calls on ${p.policyArea.name}`);
    }
  }

  const terms = profile.terms.toSorted((a, b) => a.startDate.localeCompare(b.startDate));
  expect(await keyed(page.locator('#career [data-term]'), 'data-term')).toEqual(
    terms.map((t) => [
      `${t.chamber}:${t.startDate}`,
      [t.state, t.district, t.party, t.startDate, t.endDate],
    ]),
  );
  for (const term of terms) {
    const row = page.locator(`#career [data-term="${term.chamber}:${term.startDate}"]`);
    await text(row, `${term.startDate.slice(0, 4)}–${term.endDate?.slice(0, 4) ?? 'present'}`);
    await text(row, seatLabel(term.chamber, term.state, term.district));
    await text(row, term.party);
  }
  const campaigns = profile.candidacies.toSorted((a, b) => a.cycle - b.cycle);
  expect(await keyed(page.locator('#career [data-campaign]'), 'data-campaign')).toEqual(
    campaigns.map((c) => [`${c.chamber}:${c.cycle}`, [c.state, c.district, c.party, c.outcome]]),
  );
  for (const campaign of campaigns) {
    const row = page.locator(`#career [data-campaign="${campaign.chamber}:${campaign.cycle}"]`);
    await text(row, campaign.cycle);
    await text(row, seatLabel(campaign.chamber, campaign.state, campaign.district));
    await text(
      row,
      campaign.outcome
        ? campaign.outcome.charAt(0).toUpperCase() + campaign.outcome.slice(1)
        : 'Outcome not recorded',
    );
  }

  if (money.cycle === null || money.totals === null) {
    await text(
      page.locator('#money'),
      `No FEC campaign totals are on file for ${money.person.fullName}`,
    );
    await expect(
      page.locator('#money [data-industry-gross], #money [data-outside-count]'),
    ).toHaveCount(0);
    return { profile, scores, promises, money };
  }
  const coding = money.industryCoding;
  expect(await raw(page.locator('#money [data-industry-gross]'))).toBe(coding.grossCents);
  const industries = page.getByRole('list', {
    name: 'PAC contributions by industry, before refunds',
  });
  if (coding.grossCents === 0)
    await text(page.locator('#money [data-industry-gross]'), 'No itemized PAC contributions');
  else {
    expect(await raw(page.locator('#money [data-industry-coverage]'))).toBe(coding.coverage);
    await text(page.locator('#money [data-industry-coverage]'), formatShare(coding.coverage));
    await text(page.locator('#money [data-industry-gross]'), formatCents(coding.grossCents));
    const ranked = money.industries.toSorted((a, b) => b.grossCents - a.grossCents);
    const bars = ranked.slice(0, 10).map((i) => [i.industry.id, i.grossCents]);
    if (ranked.length > 10)
      bars.push(['other-coded', ranked.slice(10).reduce((n, i) => n + i.grossCents, 0)]);
    if (coding.uncodedGrossCents > 0) bars.push(['not-coded', coding.uncodedGrossCents]);
    expect(await keyed(industries.locator('[data-bar]'), 'data-bar')).toEqual(bars);
    for (const i of ranked.slice(0, 10)) {
      const bar = industries.locator(`[data-bar="${i.industry.id}"]`);
      await text(bar, i.industry.name);
      await text(bar, formatCents(i.grossCents));
      await text(bar, formatShare(i.grossCents / coding.grossCents));
    }
    if (coding.uncodedGrossCents > 0)
      await text(
        industries.locator('[data-bar="not-coded"]'),
        formatCents(coding.uncodedGrossCents),
      );
  }

  const outside = money.outsideSpending;
  expect(await raw(page.locator('#money [data-outside-count]'))).toEqual([
    outside.spenders.length,
    outside.itemCount,
  ]);
  if (outside.itemCount === 0)
    await text(page.locator('#money [data-outside-count]'), 'No independent expenditures');
  else {
    await text(
      page.locator('#money [data-outside-count]'),
      `${formatNumber(outside.spenders.length)} spenders, ${formatNumber(outside.itemCount)} expenditures`,
    );
    const list = page.getByRole('list', { name: 'Outside spending for and against' });
    expect(await keyed(list.locator('[data-bar]'), 'data-bar')).toEqual([
      ['support', outside.supportCents],
      ['oppose', outside.opposeCents],
    ]);
    await text(list.locator('[data-bar="support"]'), formatCents(outside.supportCents));
    await text(list.locator('[data-bar="oppose"]'), formatCents(outside.opposeCents));
    const shownSpenders = outside.spenders.slice(0, 12);
    expect(await keyed(page.locator('#money [data-spender]'), 'data-spender')).toEqual(
      shownSpenders.map((s) => [
        `${s.spenderFecCommitteeId}:${s.supportOppose}`,
        [s.amountCents, s.expenditures, s.latestDate],
      ]),
    );
    for (const s of shownSpenders) {
      const row = page.locator(
        `#money [data-spender="${s.spenderFecCommitteeId}:${s.supportOppose}"]`,
      );
      await text(row.locator('td').nth(0), s.spenderName);
      await text(row.locator('td').nth(1), s.supportOppose === 'support' ? 'For' : 'Against');
      await text(row.locator('td').nth(2), formatNumber(s.expenditures));
      await text(row.locator('td').nth(3), formatCents(s.amountCents));
    }
    await page
      .locator('#money details')
      .filter({ has: page.getByText(/largest single expenditures, with sources/) })
      .locator('summary')
      .click();
    expect(await keyed(page.locator('#money [data-expenditure]'), 'data-expenditure')).toEqual(
      outside.items.map((i) => [
        i.provenance.sourceKey,
        [i.spenderName, i.supportOppose, i.amountCents, i.expenditureDate],
      ]),
    );
    for (const [index, item] of outside.items.entries()) {
      const row = page.locator('#money [data-expenditure]').nth(index);
      await text(row.locator('td').nth(0), item.spenderName);
      await text(row.locator('td').nth(1), item.supportOppose === 'support' ? 'For' : 'Against');
      await text(row.locator('td').nth(2), formatDate(item.expenditureDate) ?? 'No date');
      await text(row.locator('td').nth(3), formatCents(item.amountCents));
    }
  }
  return { profile, scores, promises, money };
}

export async function checkSources(page: Page, baseUrl: string, agreed: Agreed) {
  await page.goto(`${baseUrl}/sources`);
  const status = await agreed<CapabilityOutput<'sources.status'>>('sources.status', {});
  expect(await raw(page.locator('[data-refreshed]'))).toEqual(status.readModelRefreshedAt);
  await text(
    page.locator('[data-refreshed]'),
    formatDate(status.readModelRefreshedAt) ?? 'Not yet',
  );
  expect(await raw(page.locator('[data-source-count]'))).toBe(status.sources.length);
  await expect(page.locator('[data-source-count]')).toHaveText(String(status.sources.length));
  const coding = status.coverage.industryCoding;
  const coverage = page.locator('[data-coverage]');
  expect(await raw(coverage)).toEqual([coding.coverage, coding.codedCents, coding.totalCents]);
  await text(coverage, formatShare(coding.coverage, 1) ?? 'No PAC data');
  if (coding.totalCents > 0) {
    await text(coverage, formatCents(coding.codedCents));
    await text(coverage, formatCents(coding.totalCents));
  }
  expect(await keyed(page.locator('[data-source]'), 'data-source')).toEqual(
    status.sources.map((s) => [
      s.id,
      [
        s.lastRun?.status ?? null,
        s.lastRun?.id ?? null,
        s.lastSuccess?.id ?? null,
        s.lastSuccess?.finishedAt ?? s.lastSuccess?.startedAt ?? null,
      ],
    ]),
  );
  for (const source of status.sources) {
    const item = page.locator(`[data-source="${source.id}"]`);
    await expect(item.getByRole('heading')).toHaveText(source.name);
    await text(item, source.license);
    const counts = source.lastRun?.counts ?? {};
    const observed = await keyed(item.locator('[data-count]'), 'data-count');
    expect(Object.fromEntries(observed as [string, unknown][])).toEqual(counts);
    for (const [key, value] of Object.entries(counts)) {
      // Unit expectations are written here, not delegated to the app's runCountRows.
      const expected = key.includes('cents')
        ? formatCents(value)
        : key.includes('bps')
          ? formatShare(value / 10_000, 1)
          : formatNumber(value);
      await expect(item.locator(`[data-count="${key}"] span`).last()).toHaveText(expected ?? '');
    }
    if (source.lastRun)
      await text(
        item,
        source.lastRun.status.charAt(0).toUpperCase() + source.lastRun.status.slice(1),
      );
    else await text(item, 'No runs yet');
    if (source.lastRun?.error) await text(item, `Error: ${source.lastRun.error}`);
    if (source.lastSuccess)
      await text(
        item,
        `(run ${source.lastSuccess.id}, adapter ${source.lastSuccess.adapterVersion}, scope ${source.lastSuccess.scope})`,
      );
    else await text(item, 'Never');
  }
  return status;
}

export async function checkHome(page: Page, baseUrl: string, agreed: Agreed) {
  await page.goto(baseUrl);
  const table = await agreed<CapabilityOutput<'explore.table'>>('explore.table', { limit: 4 });
  const facets = await agreed<CapabilityOutput<'explore.facets'>>('explore.facets', {});
  const status = await agreed<CapabilityOutput<'sources.status'>>('sources.status', {});
  const areas = await agreed<CapabilityOutput<'policy.areas'>>('policy.areas', {});
  const frameworks = await agreed<CapabilityOutput<'frameworks.list'>>('frameworks.list', {});
  expect(await raw(page.locator('[data-areas]'))).toBe(areas.items.length);
  await expect(page.locator('[data-areas]')).toHaveText(String(areas.items.length));
  if (table.scorecardColumns.length > 0) {
    expect(await raw(page.locator('[data-scorecards]'))).toBe(table.scorecardColumns.length);
    await expect(page.locator('[data-scorecards]')).toHaveText(
      String(table.scorecardColumns.length),
    );
  }
  if (frameworks.items.length > 0) {
    expect(await raw(page.locator('[data-frameworks]'))).toBe(frameworks.items.length);
    await expect(page.locator('[data-frameworks]')).toHaveText(String(frameworks.items.length));
  }
  expect(await raw(page.locator('[data-facet="current"]'))).toBe(facets.scopes.current);
  await expect(page.locator('[data-facet="current"]')).toHaveText(
    formatNumber(facets.scopes.current) ?? '',
  );
  expect(await raw(page.locator('[data-total]'))).toBe(table.total);
  await expect(page.locator('[data-total]')).toHaveText(formatNumber(table.total) ?? '');
  expect(
    await page
      .locator('tbody tr[data-slug]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slug'))),
  ).toEqual(table.rows.map((r) => r.slug));
  for (const row of table.rows) {
    const tr = page.locator(`tbody tr[data-slug="${row.slug}"]`);
    await expect(tr.locator('th a')).toHaveText(row.fullName);
    for (const [column, value, display] of [
      ['total', row.totalReceiptsCents, formatCents(row.totalReceiptsCents, { compact: true })],
      ['pac', row.pacShare, formatShare(row.pacShare)],
      ['missed', row.missedVoteRate, formatShare(row.missedVoteRate)],
    ] as const) {
      const cell = tr.locator(`[data-column="${column}"]`);
      expect(await raw(cell)).toEqual(value);
      await expect(cell).toHaveText(display ?? 'No data');
    }
  }
  expect(await keyed(page.locator('[data-source]'), 'data-source')).toEqual(
    status.sources.map((s) => [
      s.id,
      [s.lastSuccess?.finishedAt ?? s.lastSuccess?.startedAt ?? null, s.lastRun?.status ?? null],
    ]),
  );
  for (const source of status.sources) {
    const item = page.locator(`[data-source="${source.id}"]`);
    await text(item, source.name);
    await text(
      item,
      source.lastSuccess
        ? `Last loaded ${formatDate(source.lastSuccess.finishedAt ?? source.lastSuccess.startedAt)}`
        : 'Not loaded yet',
    );
    if (source.lastRun && source.lastRun.status !== 'succeeded')
      await text(item, `Latest run ${source.lastRun.status}`);
  }
  expect(await raw(page.locator('[data-coverage]'))).toBe(status.coverage.industryCoding.coverage);
  await text(
    page.locator('[data-coverage]'),
    formatShare(status.coverage.industryCoding.coverage) ?? 'No PAC data yet',
  );
  return { table, facets, status };
}

export async function checkPolicy(page: Page, baseUrl: string, agreed: Agreed) {
  const areas = await agreed<CapabilityOutput<'policy.areas'>>('policy.areas', {});
  expect(areas.items.some((a) => a.rollcallCount > 0)).toBe(true);
  await page.goto(`${baseUrl}/policy`);
  expect(await keyed(page.locator('tr[data-area]'), 'data-area')).toEqual(
    areas.items.map((a) => [a.id, [a.billCount, a.rollcallCount]]),
  );
  for (const area of areas.items) {
    const row = page.locator(`tr[data-area="${area.id}"]`);
    await expect(row.locator('th')).toHaveText(area.name);
    await expect(row.locator('td').nth(0)).toHaveText(formatNumber(area.billCount) ?? '');
    await expect(row.locator('td').nth(1)).toHaveText(
      area.rollcallCount > 0 ? (formatNumber(area.rollcallCount) ?? '') : 'None yet',
    );
  }
  const area = areas.items.find((a) => a.rollcallCount > 0);
  if (!area) throw new Error('missing populated policy area');
  const byChamber = await Promise.all(
    (['house', 'senate'] as const).map(
      async (chamber) =>
        [
          chamber,
          await agreed<CapabilityOutput<'votes.list'>>('votes.list', {
            policyArea: area.id,
            chamber,
            limit: 10,
          }),
        ] as const,
    ),
  );
  const [house, senate] = byChamber.map(([, votes]) => votes.total);
  for (const [chamber, votes] of byChamber) {
    await page.goto(`${baseUrl}/policy/${area.id}?chamber=${chamber}`);
    const header = page.locator('header[data-area]');
    expect(await raw(header)).toEqual([area.billCount, area.rollcallCount, house, senate]);
    await expect(header.locator('h1')).toHaveText(area.name);
    await text(
      header,
      `${formatNumber(area.billCount)} bills and ${formatNumber(area.rollcallCount)} roll calls`,
    );
    expect(await keyed(page.locator('li[data-rollcall]'), 'data-rollcall')).toEqual(
      votes.items.map((v) => [
        `${v.rollcall.chamber}.${v.rollcall.congress}.${v.rollcall.number}`,
        [v.tally.yea, v.tally.nay, v.rollcall.result],
      ]),
    );
    for (const [i, vote] of votes.items.entries()) {
      const row = page.locator('li[data-rollcall]').nth(i);
      await text(row, vote.rollcall.result);
      await text(row, `Yea ${vote.tally.yea}`);
      await text(row, `Nay ${vote.tally.nay}`);
      await text(row, `Present ${vote.tally.present}`);
      await text(row, `Not voting ${vote.tally.notVoting}`);
      const parties = row.locator('table tbody tr');
      await expect(parties).toHaveCount(vote.byParty.length);
      for (const [partyIndex, party] of vote.byParty.entries()) {
        const partyRow = parties.nth(partyIndex);
        await text(partyRow.locator('th'), party.party);
        await expect(partyRow.locator('td')).toHaveText([
          String(party.yea),
          String(party.nay),
          String(party.present + party.notVoting),
        ]);
      }
    }
    if (votes.items.length === 0) {
      await text(
        page.locator('main'),
        `No ${chamber === 'house' ? 'House' : 'Senate'} roll calls in this area yet`,
      );
      continue;
    }
    const matrix = await agreed<CapabilityOutput<'frameworks.evaluate'>>('frameworks.evaluate', {
      framework: {
        title: `${area.name} roll calls`,
        rules: votes.items.map((v) => ({
          target: {
            kind: 'rollcall',
            congress: v.rollcall.congress,
            chamber: v.rollcall.chamber,
            number: v.rollcall.number,
          },
          alignedPosition: 'yea',
        })),
      },
      people: { chamber },
      limit: 100,
      offset: 0,
    });
    expect(matrix.results.length).toBeGreaterThan(0);
    expect(await keyed(page.locator('tr[data-slug][data-value]'), 'data-slug')).toEqual(
      matrix.results.map((r) => [
        r.person.slug,
        votes.items.map((_, i) => r.votes.find((v) => v.ruleIndex === i)?.position ?? null),
      ]),
    );
    for (const result of matrix.results) {
      const row = page.locator(`tr[data-slug="${result.person.slug}"]`);
      await expect(row.locator('th a')).toHaveText(result.person.fullName);
      for (const [i] of votes.items.entries()) {
        const cast = result.votes.find((v) => v.ruleIndex === i);
        const label = cast
          ? { yea: 'Yea', nay: 'Nay', present: 'Present', not_voting: 'Not voting' }[cast.position]
          : 'Not a member at the time';
        // Screen-reader text is an ordinary readable label, not the raw-value hook.
        await expect(row.locator('td').nth(i).locator('.sr-only')).toHaveText(label);
      }
    }
  }
  return areas;
}
