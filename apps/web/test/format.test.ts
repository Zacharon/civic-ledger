import { describe, expect, it } from 'vitest';
import {
  chamberLabel,
  formatCents,
  formatDate,
  formatNumber,
  formatOutOf,
  formatScore,
  formatShare,
  formatSigned,
  formatYears,
  memberTitle,
  ordinal,
  partyAbbreviation,
  safeHref,
  seatLabel,
} from '../src/lib/format';
import { pageWindow } from '../src/lib/pages';
import { partyTone } from '../src/lib/party';

describe('formatCents (integer cents → dollars)', () => {
  it('formats whole dollars with separators', () => {
    expect(formatCents(123_456_789)).toBe('$1,234,568');
    expect(formatCents(0)).toBe('$0');
    expect(formatCents(99)).toBe('$1');
  });
  it('compacts to K, M and B', () => {
    expect(formatCents(28_742_341_00, { compact: true })).toBe('$28.7M');
    expect(formatCents(36_000_000_00, { compact: true })).toBe('$36M');
    expect(formatCents(320_071_00, { compact: true })).toBe('$320K');
    expect(formatCents(1_500_000_000_00, { compact: true })).toBe('$1.5B');
    expect(formatCents(512_00, { compact: true })).toBe('$512');
    expect(formatCents(150_000_000_00, { compact: true })).toBe('$150M');
  });
  it('uses a true minus sign for negatives', () => {
    expect(formatCents(-500_00)).toBe('−$500');
    expect(formatCents(-2_500_000_00, { compact: true })).toBe('−$2.5M');
  });
  it('returns null for no data, never zero', () => {
    expect(formatCents(null)).toBeNull();
    expect(formatCents(Number.NaN)).toBeNull();
  });
});

describe('formatShare (fractions 0–1 → %)', () => {
  it('rounds to whole percent by default', () => {
    expect(formatShare(0.3412)).toBe('34%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.811, 1)).toBe('81.1%');
  });
  it('never shows a non-zero share as 0%', () => {
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(0.0004, 1)).toBe('<0.1%');
  });
  it('returns null for no data', () => {
    expect(formatShare(null)).toBeNull();
  });
});

describe('other number formats', () => {
  it('signs scores with a true minus', () => {
    expect(formatSigned(-0.381)).toBe('−0.381');
    expect(formatSigned(0.42)).toBe('+0.420');
    expect(formatSigned(0)).toBe('0.000');
    expect(formatSigned(-0.0001)).toBe('0.000');
    expect(formatSigned(null)).toBeNull();
  });
  it('formats counts, scores, years and X of Y', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(null)).toBeNull();
    expect(formatScore(82)).toBe('82');
    expect(formatScore(3.25)).toBe('3.3');
    expect(formatYears(0.4)).toBe('<1 yr');
    expect(formatYears(1.9)).toBe('1 yr');
    expect(formatYears(12.3)).toBe('12 yrs');
    expect(formatYears(null)).toBeNull();
    expect(formatOutOf(29, 31)).toBe('29 of 31');
  });
  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 119].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '111th',
      '119th',
    ]);
  });
  it('formats dates in UTC regardless of the server zone', () => {
    expect(formatDate('2026-10-01')).toBe('Oct 1, 2026');
    expect(formatDate('2026-10-16T23:30:00Z')).toBe('Oct 16, 2026');
    expect(formatDate(null)).toBeNull();
    expect(formatDate('not a date')).toBeNull();
  });
});

describe('seats and parties', () => {
  it('labels seats', () => {
    expect(seatLabel('house', 'ZV', 3)).toBe('ZV-3');
    expect(seatLabel('house', 'ZV', 0)).toBe('ZV at-large');
    expect(seatLabel('senate', 'ZV', null)).toBe('ZV');
    expect(seatLabel(null, null, null)).toBeNull();
    expect(chamberLabel('senate')).toBe('Senate');
    expect(memberTitle('house')).toBe('Representative');
    expect(memberTitle(null)).toBeNull();
  });
  it('abbreviates any party name without a hardcoded list', () => {
    expect(partyAbbreviation('Democratic')).toBe('D');
    expect(partyAbbreviation('Republican')).toBe('R');
    expect(partyAbbreviation('Independent')).toBe('I');
    expect(partyAbbreviation('Harbor Party')).toBe('H');
    expect(partyAbbreviation('Working Families Party')).toBe('WF');
    expect(partyAbbreviation(null)).toBeNull();
  });
  it('gives party color only to known major parties; everything else is neutral', () => {
    expect(partyTone('Democratic')).toBe('democratic');
    expect(partyTone('Democrat')).toBe('democratic');
    expect(partyTone('Republican')).toBe('republican');
    expect(partyTone('Independent')).toBe('neutral');
    expect(partyTone('Harbor Party')).toBe('neutral');
    expect(partyTone(null)).toBe('neutral');
  });
});

describe('safeHref (untrusted URLs from data)', () => {
  it('allows only http and https', () => {
    expect(safeHref('https://voteview.com/')).toBe('https://voteview.com/');
    expect(safeHref('http://example.org/a b')).toBe('http://example.org/a%20b');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('elides the middle of long ranges', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 16, 17, 18, 19, 20]);
  });
});
