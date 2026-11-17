/**
 * The members chosen for Compare travel in the URL, like every other view state: `ids=`
 * on /compare, `compare=` on Explore and profiles. Browsing the table and opening
 * profiles keeps the list, so each "Add to comparison" adds to it instead of starting over.
 */

export const COMPARE_MAX = 4;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Comma-separated slugs: lower-cased, invalid ones dropped, de-duplicated, at most four. */
export function parseCompareIds(value: string | null | undefined): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG.test(s) && s.length <= 120);
  return [...new Set(ids)].slice(0, COMPARE_MAX);
}

/** Congress and FEC cycle chosen on Compare; null = each member's latest (v1). */
export interface ComparePeriod {
  congress: number | null;
  cycle: number | null;
}

/** Compare link; the period is added only when one is chosen, so v1 links are unchanged. */
export function compareHref(ids: readonly string[], period?: Partial<ComparePeriod>): string {
  const parts: string[] = [];
  if (ids.length > 0) parts.push(`ids=${ids.join(',')}`);
  if (period?.congress != null) parts.push(`congress=${period.congress}`);
  if (period?.cycle != null) parts.push(`cycle=${period.cycle}`);
  return parts.length > 0 ? `/compare?${parts.join('&')}` : '/compare';
}

type Param = string | string[] | undefined;
const firstOf = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** A whole number in [min, max] or null (same bounds as core's CongressSchema / CycleSchema). */
function boundedInt(value: Param, min: number, max: number): number | null {
  const text = firstOf(value);
  if (!text || !/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export const parseCongress = (value: Param) => boundedInt(value, 1, 200);

/** `congress` and `cycle` from the query; anything invalid means "no period" (v1). */
export function parsePeriod(query: { congress?: Param; cycle?: Param }): ComparePeriod {
  return { congress: parseCongress(query.congress), cycle: boundedInt(query.cycle, 1976, 2100) };
}

export const AGREEMENT_FILTERS = ['all', 'agreed', 'disagreed', 'excluded'] as const;
export type AgreementFilter = (typeof AGREEMENT_FILTERS)[number];

export function parseAgreementFilter(value: Param): AgreementFilter {
  const text = firstOf(value);
  return AGREEMENT_FILTERS.find((f) => f === text) ?? 'all';
}

export interface AgreementLink {
  a: string;
  b: string;
  /** The comparison to return to. */
  ids?: readonly string[];
  congress?: number | null;
  /** Kept so "Back to comparison" restores the money period too. */
  cycle?: number | null;
  filter?: AgreementFilter;
  page?: number;
}

/** The drilldown for one pair; every page link keeps the pair, period, filter and list. */
export function agreementHref(link: AgreementLink): string {
  const parts = [`a=${link.a}`, `b=${link.b}`];
  if (link.ids && link.ids.length > 0) parts.push(`ids=${link.ids.join(',')}`);
  if (link.congress != null) parts.push(`congress=${link.congress}`);
  if (link.cycle != null) parts.push(`cycle=${link.cycle}`);
  if (link.filter && link.filter !== 'all') parts.push(`filter=${link.filter}`);
  if (link.page && link.page > 1) parts.push(`page=${link.page}`);
  return `/compare/agreement?${parts.join('&')}`;
}

function ordinalOf(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export const congressLabel = (congress: number) => `${ordinalOf(congress)} Congress`;

/** The vote period in prose: "the 118th Congress" or "all loaded history". */
export function votesPeriodLabel(period: {
  basis: 'all_loaded' | 'congress';
  congress: number | null;
}): string {
  return period.basis === 'congress' && period.congress !== null
    ? `the ${congressLabel(period.congress)}`
    : 'all loaded history';
}

const integer = new Intl.NumberFormat('en-US');

/** Always "X of Y": a share of one or two votes is never shown as a bare percentage. */
export function agreementSentence(agreed: number, shared: number, periodLabel: string): string {
  if (shared === 0) return `No shared recorded votes in ${periodLabel}.`;
  const noun = shared === 1 ? 'vote' : 'votes';
  return `Agreed on ${integer.format(agreed)} of ${integer.format(shared)} shared recorded ${noun} in ${periodLabel}.`;
}

export const disagreementsLinkText = (n: number) =>
  `Open the ${integer.format(n)} ${n === 1 ? 'disagreement' : 'disagreements'}`;

/** A profile link that keeps the comparison in progress. */
export const profileHref = (slug: string, ids: readonly string[] | null | undefined) =>
  ids && ids.length > 0 ? `/people/${slug}?compare=${ids.join(',')}` : `/people/${slug}`;

/** Explore with the comparison in progress (and any other query already built). */
export function exploreHref(ids: readonly string[], query = ''): string {
  const params = new URLSearchParams(query);
  if (ids.length > 0) params.set('compare', ids.join(','));
  const search = params.toString().replaceAll('%2C', ',');
  return search ? `/explore?${search}` : '/explore';
}

export interface ExclusionCounts {
  total: number;
  notServing: number;
  unavailable: number;
  notVoting: number;
  present: number;
}

/** "Not counted: 1 present, 3 not serving in that chamber." or null when nothing is excluded. */
export function exclusionText(excluded: ExclusionCounts): string | null {
  if (excluded.total === 0) return null;
  const parts = [
    [excluded.present, 'present'],
    [excluded.notVoting, 'not voting'],
    [excluded.unavailable, 'serving but no vote record stored'],
    [excluded.notServing, 'not serving in that chamber'],
  ] as const;
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${integer.format(n)} ${label}`)
    .join(', ');
  return `Not counted: ${text}.`;
}
