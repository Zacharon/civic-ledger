import type { CSSProperties } from 'react';
import { ScrollRegion } from '@/components/scroll-region';
import {
  type Attendance,
  type AttendanceMonth,
  attendanceSummary,
  missedShare,
  monthLabel,
  monthSentence,
  monthShort,
  monthStatusLabel,
} from '@/lib/attendance';
import { formatNumber, formatShare, ordinal } from '@/lib/format';

const CELL_CLASS: Record<AttendanceMonth['status'], string> = {
  served: 'attend-cell',
  no_votes_held: 'attend-cell attend-cell-none',
  not_yet_serving: 'attend-cell attend-cell-away',
  no_longer_serving: 'attend-cell attend-cell-away',
  not_serving: 'attend-cell attend-cell-away',
  no_record: 'attend-cell attend-cell-norecord',
};

/**
 * Attendance by month for one Congress. Each month is a labeled cell: eligible votes
 * (the stated denominator), the missed count as a grey fill on a track, and present as
 * its own number. Months with no votes held, before service, or after service are drawn
 * and worded differently from a month with zero misses. The same numbers sit in a table
 * behind a disclosure, and every cell is a text sentence for assistive technology.
 * Greys only: no red, no party color, no Yea/Nay colors.
 */
export function AttendanceStrip({ attendance }: { attendance: Attendance }) {
  if (attendance.months.length === 0 || attendance.congress === null) return null;
  const { congress, months, totals } = attendance;
  return (
    <figure
      className="min-w-0"
      data-attendance
      data-value={JSON.stringify([totals.eligible, totals.missed, totals.present])}
    >
      <h3 className="font-semibold">Attendance by month, {ordinal(congress)} Congress</h3>
      <p className="mt-1 max-w-3xl text-sm text-ink-2" data-attendance-summary>
        {attendanceSummary(attendance)}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="vote-key vote-not-voting" />
          Not voting: the filled part of each bar
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="vote-key vote-present" />
          Present: counted separately, not a missed vote
        </li>
      </ul>
      <ol
        aria-label={`Attendance by month, ${ordinal(congress)} Congress`}
        className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
      >
        {months.map((m) => (
          <MonthCell key={m.month} m={m} />
        ))}
      </ol>
      <details className="disclosure mt-4">
        <summary>Attendance by month as a table</summary>
        <ScrollRegion label="Attendance by month table" className="mt-2">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">
              Eligible, not voting and present roll-call votes per month, {ordinal(congress)}{' '}
              Congress
            </caption>
            <thead>
              <tr className="border-b border-control text-left text-ink-2">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Month
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Eligible
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Not voting
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Present
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr
                  key={m.month}
                  data-month={m.month}
                  data-value={JSON.stringify([m.status, m.eligible, m.missed, m.present])}
                  className="border-b border-rule"
                >
                  <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                    {monthLabel(m.month)}
                  </th>
                  <td className="num py-2 pr-4 text-right">{formatNumber(m.eligible)}</td>
                  <td className="num py-2 pr-4 text-right">{formatNumber(m.missed)}</td>
                  <td className="num py-2 pr-4 text-right">{formatNumber(m.present)}</td>
                  <td className="py-2 text-ink-2">{monthStatusLabel(m.status) || 'Votes held'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink font-semibold" data-attendance-total>
                <th scope="row" className="py-2 pr-4 text-left">
                  Whole Congress
                </th>
                <td className="num py-2 pr-4 text-right">{formatNumber(totals.eligible)}</td>
                <td className="num py-2 pr-4 text-right">{formatNumber(totals.missed)}</td>
                <td className="num py-2 pr-4 text-right">{formatNumber(totals.present)}</td>
                <td className="py-2 font-normal text-ink-2">
                  {formatShare(totals.missedRate, 1) ?? 'No data'} not voting
                </td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>
      </details>
    </figure>
  );
}

function MonthCell({ m }: { m: AttendanceMonth }) {
  const year = m.month.slice(0, 4);
  return (
    <li
      className={CELL_CLASS[m.status]}
      data-month-cell={m.month}
      data-status={m.status}
      data-value={JSON.stringify([m.status, m.eligible, m.missed, m.present])}
    >
      <p className="font-semibold">
        {monthShort(m.month)} <span className="num">{year}</span>
      </p>
      {m.status === 'served' ? (
        <>
          <p className="mt-1 text-sm" aria-hidden="true">
            Of <span className="num font-semibold">{formatNumber(m.eligible)}</span> eligible{' '}
            {m.eligible === 1 ? 'vote' : 'votes'}
          </p>
          <div className="attend-track mt-2" aria-hidden="true">
            <div
              className="attend-fill"
              style={{ '--v': `${missedShare(m) * 100}%` } as CSSProperties}
            />
          </div>
          <p
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm"
            aria-hidden="true"
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="vote-key vote-not-voting" />
              <span className="num font-semibold">{formatNumber(m.missed)}</span> not voting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="vote-key vote-present" />
              <span className="num font-semibold">{formatNumber(m.present)}</span> present
            </span>
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm font-semibold text-ink-2" aria-hidden="true">
          {monthStatusLabel(m.status)}
        </p>
      )}
      <p className="sr-only">{monthSentence(m)}</p>
    </li>
  );
}
