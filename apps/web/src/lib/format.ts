/**
 * Wire-format to display text (DECISIONS A11: money in integer cents, shares as
 * fractions 0–1, `null` = no data). Every helper returns `null` for missing data so
 * callers render an explicit "No data" instead of a misleading zero.
 */

const MINUS = '−';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `123456789` cents → `$1,234,568`; `compact` → `$1.2M`. */
export function formatCents(cents: number | null, options: { compact?: boolean } = {}) {
  if (cents === null || !Number.isFinite(cents)) return null;
  const dollars = cents / 100;
  if (!options.compact) return withMinus(usd.format(Math.round(dollars)));
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? MINUS : '';
  if (abs >= 1e9) return `${sign}$${trimZero(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trimZero(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trimZero(abs / 1e3)}K`;
  return `${sign}$${integer.format(Math.round(abs))}`;
}

function trimZero(value: number): string {
  const digits = value >= 100 ? 0 : 1;
  return value.toFixed(digits).replace(/\.0$/, '');
}

/** Fraction `0.3412` → `34%`. Non-zero values under 1% read `<1%` rather than `0%`. */
export function formatShare(share: number | null, digits = 0) {
  if (share === null || !Number.isFinite(share)) return null;
  const percent = share * 100;
  const threshold = 10 ** -digits;
  if (percent > 0 && percent < threshold) return `<${threshold}%`;
  return `${percent.toFixed(digits)}%`;
}

/** Signed score with a true minus sign: `-0.381` → `−0.381`, `0.42` → `+0.420`. */
export function formatSigned(value: number | null, digits = 3) {
  if (value === null || !Number.isFinite(value)) return null;
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return `${value < 0 ? MINUS : '+'}${fixed}`;
}

export function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return withMinus(integer.format(value));
}

/** Scorecard value on its publisher's scale, e.g. `82` or `3.5`. */
export function formatScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return withMinus(Number.isInteger(value) ? String(value) : value.toFixed(1));
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** ISO date or datetime → `Oct 1, 2026` (UTC, so the server and browser agree). */
export function formatDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date);
}

export function formatYears(years: number | null) {
  if (years === null || !Number.isFinite(years) || years < 0) return null;
  if (years < 1) return '<1 yr';
  const whole = Math.floor(years);
  return `${whole} ${whole === 1 ? 'yr' : 'yrs'}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** `aligned X of Y` with the counts spelled out. */
export function formatOutOf(x: number, y: number) {
  return `${integer.format(x)} of ${integer.format(y)}`;
}

type Chamber = 'house' | 'senate';

export function chamberLabel(chamber: Chamber | null) {
  if (chamber === null) return null;
  return chamber === 'senate' ? 'Senate' : 'House';
}

/** `ZV-3`, `ZV at-large` (district 0), `ZV` (Senate), or null when the seat is unknown. */
export function seatLabel(chamber: Chamber | null, state: string | null, district: number | null) {
  if (!state) return null;
  if (chamber !== 'house' || district === null) return state;
  return district === 0 ? `${state} at-large` : `${state}-${district}`;
}

export function memberTitle(chamber: Chamber | null) {
  if (chamber === 'senate') return 'Senator';
  if (chamber === 'house') return 'Representative';
  return null;
}

/** Short party label for chips: `Democratic` → `D`, `Harbor Party` → `HP`. */
export function partyAbbreviation(party: string | null) {
  if (!party) return null;
  const words = party
    .replace(/\bparty\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return party.slice(0, 1).toUpperCase();
  if (words.length === 1) return words[0]?.slice(0, 1).toUpperCase() ?? null;
  return words
    .slice(0, 3)
    .map((w) => w.slice(0, 1).toUpperCase())
    .join('');
}

function withMinus(text: string): string {
  return text.replace('-', MINUS);
}

/** Only http(s) links from data reach `href`; anything else renders as plain text. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Official roll-call number for display. `number` is Voteview's own sequence (continuous across
 * sessions, skipping quorum calls), so it is shown only when the clerk number is unknown.
 */
export function rollCallNumber(r: {
  number: number;
  session: number | null;
  clerkNumber: number | null;
}): string {
  if (r.clerkNumber === null) return `seq. ${r.number}`;
  return r.session === null ? `${r.clerkNumber}` : `${r.clerkNumber}, session ${r.session}`;
}

export interface ServiceSpan {
  isCurrent: boolean;
  serviceStart: string | null;
  termEnd: string | null;
}

/** `1995–2009`: first term start to last term end, by year. */
export function serviceYears({ serviceStart, termEnd }: ServiceSpan): string | null {
  if (!serviceStart) return null;
  const from = serviceStart.slice(0, 4);
  const to = termEnd ? termEnd.slice(0, 4) : 'present';
  return from === to ? from : `${from}–${to}`;
}

/** `Former member, 1995–2009` for people whose latest term has ended; null when current. */
export function formerLabel(span: ServiceSpan, prefix = 'Former member'): string | null {
  if (span.isCurrent) return null;
  const years = serviceYears(span);
  return years ? `${prefix}, ${years}` : prefix;
}

/**
 * Official titles of House rules run to 300+ words. Cut at a word boundary near `max`
 * characters; callers show the full text behind a disclosure (`FullTitle`).
 */
export function shortTitle(title: string, max = 160): { text: string; truncated: boolean } {
  if (title.length <= max) return { text: title, truncated: false };
  const cut = title.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return {
    text: `${cut.slice(0, space > max / 2 ? space : max).replace(/[;,:\s]+$/, '')}…`,
    truncated: true,
  };
}
