import type { CapabilityOutput } from '@civic-ledger/core';
import Link from 'next/link';
import { BarList, type BarListItem } from '@/components/charts/bar-list';
import { formatCents, formatShare } from '@/lib/format';
import { Figure } from './section';

type Money = CapabilityOutput<'money.summary'>;

/** Industries drawn as bars before the fold; the rest are summed in one row and listed. */
const SHOWN = 10;

/**
 * PAC money by industry on gross contributions (before refunds), so bars and shares stay
 * within [0, 100%] whatever the refunds (DECISIONS A29); the refund total is stated.
 */
export function IndustryFigure({
  coding,
  industries,
}: {
  coding: Money['industryCoding'];
  industries: Money['industries'];
}) {
  const ranked = industries.toSorted((a, b) => b.grossCents - a.grossCents);
  const shown = ranked.slice(0, SHOWN);
  const rest = ranked.slice(SHOWN);
  const restGross = rest.reduce((n, i) => n + i.grossCents, 0);
  const share = (cents: number) => formatShare(cents / coding.grossCents);
  const row = (key: string, label: BarListItem['label'], cents: number, muted = false) => ({
    key,
    label,
    value: cents,
    muted,
    display: (
      <>
        {formatCents(cents)} <span className="text-ink-3">{share(cents)}</span>
      </>
    ),
  });

  return (
    <Figure
      title="PAC money by industry"
      caption={
        <>
          In-house coding of contributing committees.{' '}
          <Link className="link" href="/methodology#industry-coding">
            How industries are coded
          </Link>
        </>
      }
    >
      {coding.grossCents === 0 ? (
        <p className="text-sm text-ink-2" data-industry-gross data-value="0">
          No itemized PAC contributions this cycle.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-2">
            <span
              className="num font-semibold text-ink"
              data-industry-coverage
              data-value={JSON.stringify(coding.coverage)}
            >
              {formatShare(coding.coverage)}
            </span>{' '}
            of{' '}
            <span
              className="num"
              data-industry-gross
              data-value={JSON.stringify(coding.grossCents)}
            >
              {formatCents(coding.grossCents)}
            </span>{' '}
            in PAC contributions is coded to an industry.
            {coding.refundsCents < 0 ? (
              <>
                {' '}
                Amounts are before <span className="num">{formatCents(-coding.refundsCents)}</span>{' '}
                in refunds (net <span className="num">{formatCents(coding.totalCents)}</span>).
              </>
            ) : null}
          </p>
          <BarList
            label="PAC contributions by industry, before refunds"
            items={[
              ...shown.map((i) =>
                row(
                  i.industry.id,
                  <>
                    {i.industry.name}
                    <span className="text-ink-3"> · {i.industry.sector}</span>
                  </>,
                  i.grossCents,
                ),
              ),
              ...(rest.length > 0
                ? [row('other-coded', `${rest.length} more coded industries`, restGross, true)]
                : []),
              ...(coding.uncodedGrossCents > 0
                ? [row('not-coded', 'Not coded', coding.uncodedGrossCents, true)]
                : []),
            ]}
          />
          {rest.length > 0 ? (
            <details className="mt-4 text-sm">
              <summary className="link cursor-pointer">
                List the {rest.length} more coded industries
              </summary>
              <ul className="mt-2 divide-y divide-rule border-y border-rule">
                {rest.map((i) => (
                  <li key={i.industry.id} className="flex justify-between gap-4 py-1.5">
                    <span className="min-w-0">
                      {i.industry.name}
                      <span className="text-ink-3"> · {i.industry.sector}</span>
                    </span>
                    <span className="num whitespace-nowrap">
                      {formatCents(i.grossCents)}{' '}
                      <span className="text-ink-3">{share(i.grossCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </Figure>
  );
}
