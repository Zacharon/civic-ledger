/**
 * Display text for glance sentences, computed in core so the API, MCP and the web UI
 * read the same words: money in integer cents, shares as fractions, null = no data.
 */

const MINUS = '−';
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function trimZero(value: number): string {
  const digits = value >= 100 ? 0 : 1;
  return value.toFixed(digits).replace(/\.0$/, '');
}

/** `123456789` cents → `$1.2M`; small amounts in whole dollars. */
export function compactCents(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? MINUS : '';
  if (abs >= 1e9) return `${sign}$${trimZero(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trimZero(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trimZero(abs / 1e3)}K`;
  return `${sign}$${integer.format(Math.round(abs))}`;
}

/** Fraction `0.3412` → `34%`; non-zero values under 1% read `<1%`. */
export function percent(share: number): string {
  const value = share * 100;
  if (value > 0 && value < 1) return '<1%';
  return `${value.toFixed(0)}%`;
}

/** Signed score with a true minus sign: `-0.381` → `−0.381`, `0.42` → `+0.420`. */
export function signed(value: number, digits = 3): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return `${value < 0 ? MINUS : '+'}${fixed}`;
}

export function count(value: number): string {
  return integer.format(value).replace('-', MINUS);
}

/** ISO date → `Oct 1, 2026` (UTC). */
export function longDate(iso: string): string {
  return dateFormat.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

export function years(value: number): string {
  if (value < 1) return 'under a year';
  const whole = Math.floor(value);
  return `${count(whole)} ${whole === 1 ? 'year' : 'years'}`;
}
