import type { CapabilityOutput } from '@civic-ledger/core';
import { formatNumber, formatShare } from './format';

export type Attendance = CapabilityOutput<'votes.attendance'>;
export type AttendanceMonth = Attendance['months'][number];

const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortMonthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});

const parse = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** `2025-03` -> `March 2025`. */
export const monthLabel = (month: string) => monthFormat.format(parse(month));
/** `2025-03` -> `Mar`. */
export const monthShort = (month: string) => shortMonthFormat.format(parse(month));

const STATUS_LABEL: Record<AttendanceMonth['status'], string> = {
  served: '',
  no_votes_held: 'No votes held',
  not_yet_serving: 'Not yet serving',
  no_longer_serving: 'No longer serving',
  not_serving: 'Not serving',
  no_record: 'No record on file',
};

/** Short, visible state of a cell that has no counts to chart. */
export const monthStatusLabel = (status: AttendanceMonth['status']) => STATUS_LABEL[status];

const count = (n: number, one: string, many = `${one}s`) =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * The full text for one month, also used for assistive technology and the table twin.
 * States the denominator: "Of N eligible votes in <month>".
 */
export function monthSentence(m: AttendanceMonth): string {
  const name = monthLabel(m.month);
  const held = m.rollcallsHeld > 0 ? `; ${count(m.rollcallsHeld, 'roll call')} held` : '';
  switch (m.status) {
    case 'served':
      return `Of ${count(m.eligible, 'eligible vote')} in ${name}, ${formatNumber(m.missed)} not voting and ${formatNumber(m.present)} present.`;
    case 'no_votes_held':
      return `No votes held in ${name} in this member's chamber.`;
    case 'not_yet_serving':
      return `Not yet serving in ${name}${held}.`;
    case 'no_longer_serving':
      return `No longer serving in ${name}${held}.`;
    case 'not_serving':
      return `Not serving in ${name}${held}.`;
    case 'no_record':
      return `${count(m.rollcallsHeld, 'roll call')} held in ${name} while serving, but no positions are on file for this member.`;
  }
}

/** Share of eligible votes recorded as not voting in a month, 0 when none are eligible. */
export function missedShare(m: AttendanceMonth): number {
  return m.eligible > 0 ? m.missed / m.eligible : 0;
}

/** The paragraph printed above the strip; its totals are the profile's own figures. */
export function attendanceSummary(a: Attendance): string {
  const { eligible, missed, present, missedRate } = a.totals;
  if (eligible === 0) return 'No eligible roll-call votes are on file for this member.';
  const served = a.months.filter((m) => m.status === 'served').length;
  return `Across ${count(served, 'month')} with votes, ${formatNumber(missed)} of ${formatNumber(eligible)} eligible votes were not voting (${formatShare(missedRate, 1)}) and ${formatNumber(present)} were present.`;
}
