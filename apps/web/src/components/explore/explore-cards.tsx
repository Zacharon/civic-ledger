import Link from 'next/link';
import { PartyChip } from '@/components/party-chip';
import { profileHref } from '@/lib/compare-list';
import type { ColumnDef, ExploreRow } from '@/lib/explore-columns';
import { chamberLabel, formerLabel, seatLabel } from '@/lib/format';
import { MetricCell } from './cell';

/** Short figures sit three to a row; scorecards, with their attribution, two to a row below. */
function cardCellClass(column: ColumnDef) {
  if (column.scorecard) return 'order-1 col-span-3 border-t border-rule pt-2';
  if (column.kind === 'industries') return 'order-1 col-span-6 border-t border-rule pt-2';
  return 'col-span-2';
}

/** Small screens: one card per member with the same visible columns as the table. */
export function ExploreCards({
  rows,
  columns,
  compare,
}: {
  rows: ExploreRow[];
  columns: ColumnDef[];
  /** Members chosen for Compare; profile links keep them. */
  compare?: string[] | null;
}) {
  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {rows.map((row) => (
        <li key={row.slug} className="py-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              href={profileHref(row.slug, compare)}
              className="link-quiet inline-flex min-h-11 min-w-0 items-center font-serif text-lg font-medium leading-snug"
            >
              {row.fullName}
            </Link>
            <PartyChip party={row.party} />
          </div>
          <p className="text-sm text-ink-2">
            {[
              chamberLabel(row.chamber),
              seatLabel(row.chamber, row.state, row.district),
              formerLabel(row, 'Former'),
            ]
              .filter(Boolean)
              .join(' · ') || 'Seat unknown'}
          </p>
          {columns.length > 0 ? (
            <dl className="xc mt-3 grid grid-cols-6 gap-x-3 gap-y-3 text-sm">
              {columns.map((c) => (
                <div key={c.id} className={cardCellClass(c)}>
                  <dt className="text-xs text-ink-3">
                    {c.header}
                    {c.scorecard ? (
                      <span className="block">
                        Self-described: {c.scorecard.selfDescribedOrientation}
                      </span>
                    ) : null}
                  </dt>
                  <dd>
                    <MetricCell column={c} row={row} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
