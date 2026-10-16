import { formatCents, formatShare } from '@/lib/format';

export interface ReceiptsTotals {
  totalReceiptsCents: number;
  individualCents: number;
  unitemizedIndividualCents: number | null;
  otherCommitteeCents: number;
  partyCents: number;
  candidateSelfCents: number;
}

interface Segment {
  key: string;
  label: string;
  cents: number;
  fill: string;
  swatch: string;
}

/** FEC receipts split into who gave, as a part-to-whole bar plus a legend table. */
export function receiptsSegments(t: ReceiptsTotals): Segment[] {
  const small = t.unitemizedIndividualCents;
  const segments: Segment[] =
    small === null
      ? [
          {
            key: 'individual',
            label: 'Individuals (itemized and small-dollar)',
            cents: t.individualCents,
            fill: 'fill-data-2',
            swatch: 'bg-data-2',
          },
        ]
      : [
          {
            key: 'small',
            label: 'Small-dollar individuals (unitemized)',
            cents: small,
            fill: 'fill-data-1',
            swatch: 'bg-data-1',
          },
          {
            key: 'itemized',
            label: 'Larger individual gifts (itemized)',
            cents: Math.max(t.individualCents - small, 0),
            fill: 'fill-data-2',
            swatch: 'bg-data-2',
          },
        ];
  segments.push(
    {
      key: 'committees',
      label: 'PACs and other committees',
      cents: t.otherCommitteeCents,
      fill: 'fill-data-3',
      swatch: 'bg-data-3',
    },
    {
      key: 'party-self',
      label: 'Party committees and the candidate’s own money',
      cents: t.partyCents + t.candidateSelfCents,
      fill: 'fill-data-4',
      swatch: 'bg-data-4',
    },
  );
  const accounted = segments.reduce((n, s) => n + s.cents, 0);
  const other = t.totalReceiptsCents - accounted;
  if (other > 0) {
    segments.push({
      key: 'other',
      label: 'Other receipts (transfers, refunds, loans)',
      cents: other,
      fill: 'fill-data-other',
      swatch: 'bg-data-other',
    });
  }
  return segments;
}

export function ReceiptsStack({ totals }: { totals: ReceiptsTotals }) {
  const segments = receiptsSegments(totals);
  const total = Math.max(totals.totalReceiptsCents, 1);
  let x = 0;
  const summary = segments.map((s) => `${s.label} ${formatShare(s.cents / total)}`).join(', ');
  return (
    <div>
      <svg
        className="block h-5 w-full"
        role="img"
        aria-label={`Where the money came from: ${summary}.`}
      >
        {segments.map((s) => {
          const width = (s.cents / total) * 100;
          const rect = (
            <rect
              key={s.key}
              x={`${x}%`}
              width={`${width}%`}
              height="20"
              className={`${s.fill} stroke-surface`}
              strokeWidth="2"
            />
          );
          x += width;
          return rect;
        })}
      </svg>
      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Receipts by type of contributor</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Contributor type</th>
            <th scope="col">Amount</th>
            <th scope="col">Share of receipts</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.key} className="border-b border-rule last:border-0">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal text-ink-2">
                <span
                  className={`mr-2 inline-block size-2.5 rounded-[2px] align-baseline ${s.swatch}`}
                  aria-hidden="true"
                />
                {s.label}
              </th>
              <td className="num py-1.5 pr-4 text-right">{formatCents(s.cents)}</td>
              <td className="num w-14 py-1.5 text-right text-ink-2">
                {formatShare(s.cents / total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
