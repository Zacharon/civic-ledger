import Link from 'next/link';
import { PartyChip } from '@/components/party-chip';
import type { ColumnDef, ExploreRow } from '@/lib/explore-columns';
import { chamberLabel, formerLabel, seatLabel } from '@/lib/format';
import { MetricCell } from './cell';

/** Small screens: one card per member with the same visible columns as the table. */
export function ExploreCards({ rows, columns }: { rows: ExploreRow[]; columns: ColumnDef[] }) {
  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {rows.map((row) => (
        <li key={row.slug} className="py-4">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              href={`/people/${row.slug}`}
              className="link-quiet min-w-0 font-serif text-lg font-medium leading-snug"
            >
              {row.fullName}
            </Link>
            <PartyChip party={row.party} />
          </div>
          <p className="mt-0.5 text-sm text-ink-2">
            {[
              chamberLabel(row.chamber),
              seatLabel(row.chamber, row.state, row.district),
              formerLabel(row, 'Former'),
            ]
              .filter(Boolean)
              .join(' · ') || 'Seat unknown'}
          </p>
          {columns.length > 0 ? (
            <dl className="xc mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {columns.map((c) => (
                <div key={c.id}>
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
