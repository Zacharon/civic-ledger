/** Value normalizers shared by adapters. All return `null` for blank input, never 0 or ''. */

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

const blank = (value: string | undefined | null): value is undefined | null | '' =>
  value === undefined || value === null || value.trim() === '';

/**
 * Exact decimal dollars → integer cents ("1234.5" → 123450, "-25" → -2500). Parsed as a
 * string so amounts never pass through binary floating point.
 */
export function dollarsToCents(value: string | undefined | null): number | null {
  if (blank(value)) return null;
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(value.trim().replaceAll(',', ''));
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new Error(`Not a dollar amount: "${value}"`);
  }
  const sign = match[1] ? -1 : 1;
  const whole = Number.parseInt(match[2] || '0', 10);
  const fraction = (match[3] ?? '').padEnd(3, '0');
  // Round half away from zero on the third decimal (FEC amounts have at most two).
  const cents = whole * 100 + Number.parseInt(fraction.slice(0, 2), 10);
  const roundUp = Number.parseInt(fraction[2] ?? '0', 10) >= 5 ? 1 : 0;
  const result = sign * (cents + roundUp);
  if (!Number.isSafeInteger(result)) throw new Error(`Amount out of range: "${value}"`);
  return result === 0 ? 0 : result;
}

export function parseIntOrNull(value: string | undefined | null): number | null {
  if (blank(value)) return null;
  const n = Number(value.trim());
  if (!Number.isInteger(n)) throw new Error(`Not an integer: "${value}"`);
  return n;
}

export function parseFloatOrNull(value: string | undefined | null): number | null {
  if (blank(value)) return null;
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new Error(`Not a number: "${value}"`);
  return n;
}

function isoDate(year: string, month: string, day: string, raw: string): string {
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Not a calendar date: "${raw}"`);
  }
  return iso;
}

/** FEC pas2 `MMDDYYYY`. */
export function dateFromMmddyyyy(value: string | undefined | null): string | null {
  if (blank(value)) return null;
  const v = value.trim();
  if (!/^\d{8}$/.test(v)) throw new Error(`Expected MMDDYYYY, got "${value}"`);
  return isoDate(v.slice(4), v.slice(0, 2), v.slice(2, 4), value);
}

/** FEC weball `MM/DD/YYYY`. */
export function dateFromSlashed(value: string | undefined | null): string | null {
  if (blank(value)) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m?.[1] || !m[2] || !m[3]) throw new Error(`Expected MM/DD/YYYY, got "${value}"`);
  return isoDate(m[3], m[1].padStart(2, '0'), m[2].padStart(2, '0'), value);
}

/**
 * FEC IE CSV `DD-MON-YY`. Two-digit years pivot at 70 (FEC data starts in the 1970s):
 * 00–69 → 20YY, 70–99 → 19YY.
 */
export function dateFromDdMonYy(value: string | undefined | null): string | null {
  if (blank(value)) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(value.trim());
  const month = m?.[2] ? MONTHS[m[2].toUpperCase()] : undefined;
  if (!m?.[1] || !m[3] || !month) throw new Error(`Expected DD-MON-YY, got "${value}"`);
  const yy = m[3];
  const year = yy.length === 4 ? yy : `${Number(yy) >= 70 ? '19' : '20'}${yy}`;
  return isoDate(year, month, m[1].padStart(2, '0'), value);
}

/** ISO date or date-time → `YYYY-MM-DD`. */
export function isoDateOrNull(value: string | undefined | null): string | null {
  if (blank(value)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m?.[1] || !m[2] || !m[3]) throw new Error(`Expected an ISO date, got "${value}"`);
  return isoDate(m[1], m[2], m[3], value);
}

/** Lowercase kebab-case ASCII slug ("Nydia M. Velázquez" → "nydia-m-velazquez"). */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function trimOrNull(value: string | undefined | null): string | null {
  return blank(value) ? null : value.trim();
}
