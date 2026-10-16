import {
  BILL_TYPES,
  type CapabilityContext,
  type CapabilityOutput,
  EXPLORE_SORT_COLUMNS,
  type FrameworkSpec,
} from '@civic-ledger/core';
import { SmokeRecorder } from './recorder';

type VotesPage = CapabilityOutput<'votes.list'>;
type Scope = 'current' | 'all';

export interface SmokeOptions {
  /** Former members to sample (spread across the alphabet). */
  formerSample: number;
  onProgress?: (calls: number, failures: number) => void;
}

const PAGE = 100;
const SCOPES: Scope[] = ['current', 'all'];
const POLICY_MATRIX_ROLLCALLS = 10;

/**
 * `pnpm smoke:real`: dispatches every public capability over a real database the way the
 * UI, `/api/v1` and MCP do (docs/INGEST.md). Read-only. Covers every current member's
 * profile reads, every Explore sort in both scopes, every policy page and a framework.
 */
export async function runRealSmoke(ctx: CapabilityContext, options: SmokeOptions) {
  const started = performance.now();
  const r = new SmokeRecorder(ctx, options.onProgress);

  await r.call('sources.status', {}, 'sources page');
  for (const scope of SCOPES) await r.call('explore.facets', { scope }, `facets ${scope}`);
  const current = await allSlugs(r, 'current');
  const former = await formerSample(r, options.formerSample);

  for (const slug of [...current, ...former]) await profileReads(r, slug);
  const sortColumns = await exploreSorts(r);
  await searchAndCompare(r, current, former);
  const policyAreas = await policyPages(r);
  await frameworks(r);

  return {
    ok: r.failures.length === 0,
    calls: r.calls,
    failureCount: r.failures.length,
    currentMembers: current.length,
    formerMembersSampled: former.length,
    sortColumns,
    policyAreas,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    byCapability: r.summary(),
    failures: r.failures,
  };
}

async function allSlugs(r: SmokeRecorder, scope: Scope): Promise<string[]> {
  const slugs: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await r.call(
      'explore.table',
      { filters: { scope }, limit: PAGE, offset },
      `all ${scope} slugs, offset ${offset}`,
    );
    if (!page) break;
    slugs.push(...page.rows.map((row) => row.slug));
    if (offset + PAGE >= page.total) break;
  }
  return slugs;
}

async function formerSample(r: SmokeRecorder, size: number): Promise<string[]> {
  if (size <= 0) return [];
  const all = await r.call('explore.facets', { scope: 'all' }, 'former sample size');
  if (!all) return [];
  const pages = 5;
  const step = Math.max(Math.floor(all.scopes.all / pages), 1);
  const picked: string[] = [];
  for (let i = 0; i < pages && picked.length < size; i++) {
    const page = await r.call(
      'explore.table',
      { filters: { scope: 'all' }, sort: [{ column: 'sortName' }], limit: PAGE, offset: i * step },
      `former sample at ${i * step}`,
    );
    const rows = page?.rows.filter((row) => !row.isCurrent) ?? [];
    picked.push(...rows.slice(0, Math.ceil(size / pages)).map((row) => row.slug));
  }
  return picked.slice(0, size);
}

async function profileReads(r: SmokeRecorder, slug: string) {
  const people = await r.call('people.get', { slug }, slug);
  const money = await r.call('money.summary', { slug }, slug);
  for (const cycle of money?.availableCycles.slice(1) ?? []) {
    await r.call('money.summary', { slug, cycle }, `${slug} cycle ${cycle}`);
  }
  await r.call('votes.list', { slug }, slug);
  await r.call('scores.list', { slug }, slug);
  await r.call('promises.list', { slug }, slug);
  return people;
}

async function exploreSorts(r: SmokeRecorder): Promise<number> {
  const first = await r.call('explore.table', { limit: 1 }, 'scorecard columns');
  const columns = [
    ...Object.keys(EXPLORE_SORT_COLUMNS),
    ...(first?.scorecardColumns.map((c) => `scorecard:${c.publisherId}`) ?? []),
  ];
  for (const scope of SCOPES) {
    for (const column of columns) {
      for (const direction of ['asc', 'desc'] as const) {
        const input = { filters: { scope }, sort: [{ column, direction }], limit: PAGE };
        const page = await r.call('explore.table', input, `${scope} ${column} ${direction}`);
        // The last page too: nulls sort last, so it is where "no data" rows collect.
        if (page && page.total > PAGE) {
          await r.call(
            'explore.table',
            { ...input, offset: Math.floor((page.total - 1) / PAGE) * PAGE },
            `${scope} ${column} ${direction}, last page`,
          );
        }
      }
    }
    for (const chamber of ['house', 'senate'] as const) {
      await r.call(
        'explore.table',
        { filters: { scope, chamber }, sort: [{ column: 'pacShare', direction: 'desc' }] },
        `${scope} ${chamber} by PAC share`,
      );
    }
  }
  return columns.length;
}

async function searchAndCompare(r: SmokeRecorder, current: string[], former: string[]) {
  for (const scope of SCOPES) await r.call('people.search', { scope, limit: PAGE }, scope);
  for (const slug of current.filter((_, i) => i % 25 === 0)) {
    await r.call('people.search', { q: slug.split('-')[0] }, `name of ${slug}`);
  }
  for (let i = 0; i + 2 < current.length; i += 3) {
    await r.call('people.compare', { slugs: current.slice(i, i + 3) }, `compare at ${i}`);
  }
  const mixed = [current[0], former[0]].filter((s): s is string => s !== undefined);
  if (mixed.length === 2) await r.call('people.compare', { slugs: mixed }, 'current + former');
}

async function policyPages(r: SmokeRecorder): Promise<number> {
  const areas = await r.call('policy.areas', {}, 'policy index');
  for (const area of areas?.items ?? []) {
    for (const chamber of ['house', 'senate'] as const) {
      const votes = await r.call(
        'votes.list',
        { policyArea: area.id, chamber, limit: POLICY_MATRIX_ROLLCALLS },
        `${area.id} ${chamber}`,
      );
      if (!votes || votes.items.length === 0) continue;
      // The policy page's "how every member voted" matrix (apps/web/app/policy/[area]).
      await r.call(
        'frameworks.evaluate',
        { framework: rollcallSpec(`${area.name} roll calls`, votes), people: { chamber } },
        `${area.id} ${chamber} matrix`,
      );
    }
  }
  return areas?.items.length ?? 0;
}

async function frameworks(r: SmokeRecorder) {
  const list = await r.call('frameworks.list', {}, 'frameworks page');
  for (const f of list?.items ?? []) {
    await r.call('frameworks.evaluate', { framework: f.spec }, `framework ${f.slug}`);
  }
  // A sample spec: the latest roll calls of each chamber plus one bill rule.
  const house = await r.call('votes.list', { chamber: 'house', limit: 5 }, 'sample spec house');
  const senate = await r.call('votes.list', { chamber: 'senate', limit: 5 }, 'sample spec senate');
  const items = [...(house?.items ?? []), ...(senate?.items ?? [])];
  const withBill = items.find((v) => v.bill && isBillType(v.bill.billType));
  const spec: FrameworkSpec = rollcallSpec('Smoke sample', { items });
  if (withBill?.bill && isBillType(withBill.bill.billType)) {
    spec.rules.push({
      target: {
        kind: 'bill',
        congress: withBill.bill.congress,
        billType: withBill.bill.billType,
        number: withBill.bill.number,
      },
      alignedPosition: 'nay',
      weight: 2,
    });
  }
  if (spec.rules.length > 0) {
    await r.call('frameworks.evaluate', { framework: spec, limit: 600 }, 'sample spec');
  }
}

function rollcallSpec(title: string, votes: Pick<VotesPage, 'items'>): FrameworkSpec {
  return {
    title,
    rules: votes.items.map((v, i) => ({
      target: {
        kind: 'rollcall' as const,
        congress: v.rollcall.congress,
        chamber: v.rollcall.chamber,
        number: v.rollcall.number,
      },
      alignedPosition: i % 2 === 0 ? ('yea' as const) : ('nay' as const),
      weight: 1,
    })),
  };
}

const isBillType = (value: string): value is (typeof BILL_TYPES)[number] =>
  (BILL_TYPES as readonly string[]).includes(value);
