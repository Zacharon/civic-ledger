import { ChevronDown } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ScrollRegion } from '@/components/scroll-region';
import {
  type Attendance,
  type AttendanceMonth,
  attendanceSummary,
  missedShare,
  monthLabel,
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
      {/* Up to 24 cells: folded on phones, where the summary above already gives the totals. */}
      <input id="attendance-months" type="checkbox" className="fold-toggle sr-only" />
      <label htmlFor="attendance-months" className="fold-label mt-4">
        Show each month
        <ChevronDown aria-hidden="true" strokeWidth={1.75} className="fold-chevron size-4" />
      </label>
      <div className="fold-body">
        <ol
          aria-label={`Attendance by month, ${ordinal(congress)} Congress`}
          className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        >
          {months.map((m) => (
            <MonthCell key={m.month} m={m} />
          ))}
        </ol>
      </div>
      <details className="disclosure mt-4">
        <summary>Attendance by month as a table</summary>
        <ScrollRegion label="Attendance by month table" className="mt-2">
          <table className="attend-table">
            <caption className="sr-only">
              Eligible, not voting, present and roll calls held per month, {ordinal(congress)}{' '}
              Congress
            </caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Eligible</th>
                <th scope="col">Not voting</th>
                <th scope="col">Present</th>
                <th scope="col">Roll calls held</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} data-month={m.month}>
                  <th scope="row">{monthLabel(m.month)}</th>
                  <td>{formatNumber(m.eligible)}</td>
                  <td>{formatNumber(m.missed)}</td>
                  <td>{formatNumber(m.present)}</td>
                  <td>{formatNumber(m.rollcallsHeld)}</td>
                  <td>{monthStatusLabel(m.status) || 'Votes held'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-attendance-total>
                <th scope="row">Whole Congress</th>
                <td>{formatNumber(totals.eligible)}</td>
                <td>{formatNumber(totals.missed)}</td>
                <td>{formatNumber(totals.present)}</td>
                <td />
                <td>{formatShare(totals.missedRate, 1) ?? 'No data'} not voting</td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>
      </details>
    </figure>
  );
}

function MonthCell({ m }: { m: AttendanceMonth }) {
  // Lean markup: this renders up to 24 cells per profile. Visible text only (no hidden
  // duplicate sentence); every number is in the text and in the table.
  return (
    <li
      className={CELL_CLASS[m.status]}
      data-month-cell={m.month}
      data-status={m.status}
      data-value={JSON.stringify([m.status, m.eligible, m.missed, m.present])}
    >
      <b>
        {monthShort(m.month)} {m.month.slice(0, 4)}
      </b>
      {m.status === 'served' ? (
        <>
          <span>
            Of <b>{formatNumber(m.eligible)}</b> eligible {m.eligible === 1 ? 'vote' : 'votes'}
          </span>
          <i className="attend-track">
            <i
              className="attend-fill"
              style={{ '--v': `${missedShare(m) * 100}%` } as CSSProperties}
            />
          </i>
          <span>
            <s className="vote-key vote-not-voting" /> <b>{formatNumber(m.missed)}</b> not voting
          </span>
          <span>
            <s className="vote-key vote-present" /> <b>{formatNumber(m.present)}</b> present
          </span>
        </>
      ) : (
        <span>
          <b>{monthStatusLabel(m.status)}</b>
        </span>
      )}
    </li>
  );
}
