import type { CapabilityOutput } from '@civic-ledger/core';
import { BarList } from '@/components/charts/bar-list';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceMark, type SourceNotes } from '@/components/sources';
import { formatCents, formatDate, formatNumber } from '@/lib/format';
import { Figure } from './section';

type Outside = CapabilityOutput<'money.summary'>['outsideSpending'];

/** Spenders listed before the fold; real Senate races have 100+ spenders and 1,000+ buys. */
const SPENDERS_SHOWN = 12;
const SIDE = { support: 'For', oppose: 'Against' } as const;

/**
 * Outside spending summed per spender and side (every expenditure counted), with the
 * largest single expenditures, each sourced, behind a disclosure.
 */
export function OutsideSpending({ outside, notes }: { outside: Outside; notes: SourceNotes }) {
  const shown = outside.spenders.slice(0, SPENDERS_SHOWN);
  const more = outside.spenders.length - shown.length;
  return (
    <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Figure
        title="Outside spending"
        caption="Independent expenditures reported to the FEC by groups not controlled by the campaign."
      >
        {outside.itemCount === 0 ? (
          <p className="text-sm text-ink-2" data-outside-count data-value="[0,0]">
            No independent expenditures reported this cycle.
          </p>
        ) : (
          <BarList
            label="Outside spending for and against"
            items={[
              {
                key: 'support',
                label: 'For this member',
                value: outside.supportCents,
                display: formatCents(outside.supportCents),
              },
              {
                key: 'oppose',
                label: 'Against this member',
                value: outside.opposeCents,
                display: formatCents(outside.opposeCents),
              },
            ]}
          />
        )}
      </Figure>
      {outside.itemCount > 0 ? (
        <div className="min-w-0">
          <h3
            className="font-semibold"
            data-outside-count
            data-value={JSON.stringify([outside.spenders.length, outside.itemCount])}
          >
            By spender{' '}
            <span className="font-normal text-ink-3">
              (<span className="num">{formatNumber(outside.spenders.length)}</span>{' '}
              {outside.spenders.length === 1 ? 'spender' : 'spenders'},{' '}
              <span className="num">{formatNumber(outside.itemCount)}</span>{' '}
              {outside.itemCount === 1 ? 'expenditure' : 'expenditures'})
            </span>
          </h3>
          <ScrollRegion label="Outside spending by spender" className="mt-3">
            <table className="w-full text-sm sm:min-w-[26rem]">
              <thead>
                <tr className="border-b border-control text-left text-ink-2">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Spender
                  </th>
                  <th scope="col" className="hidden py-2 pr-4 font-semibold sm:table-cell">
                    For or against
                  </th>
                  <th
                    scope="col"
                    className="hidden py-2 pr-4 text-right font-semibold sm:table-cell"
                  >
                    Buys
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={`${s.spenderFecCommitteeId}-${s.supportOppose}`}
                    data-spender={`${s.spenderFecCommitteeId}:${s.supportOppose}`}
                    data-value={JSON.stringify([s.amountCents, s.expenditures, s.latestDate])}
                    className="border-b border-rule"
                  >
                    <td className="py-2 pr-4">
                      {s.spenderName}
                      <span className="block text-xs text-ink-3">
                        <span className="num">{s.spenderFecCommitteeId}</span>
                        {s.latestDate ? ` · latest ${formatDate(s.latestDate)}` : ''}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-2 sm:hidden">
                        {SIDE[s.supportOppose]} ·{' '}
                        <span className="num">{formatNumber(s.expenditures)}</span>{' '}
                        {s.expenditures === 1 ? 'buy' : 'buys'}
                      </span>
                    </td>
                    <td className="hidden py-2 pr-4 sm:table-cell">{SIDE[s.supportOppose]}</td>
                    <td className="num hidden py-2 pr-4 text-right sm:table-cell">
                      {formatNumber(s.expenditures)}
                    </td>
                    <td className="num py-2 text-right whitespace-nowrap">
                      {formatCents(s.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {more > 0 ? (
            <p className="mt-2 text-sm text-ink-3">
              <span className="num">{formatNumber(more)}</span> smaller spenders are included in the
              totals.
            </p>
          ) : null}
          <LargestItems outside={outside} notes={notes} />
        </div>
      ) : null}
    </div>
  );
}

function LargestItems({ outside, notes }: { outside: Outside; notes: SourceNotes }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="link min-h-11 cursor-pointer py-3">
        {outside.items.length === 1
          ? 'The largest single expenditure, with its source'
          : `The ${formatNumber(outside.items.length)} largest single expenditures, with sources`}
      </summary>
      <ScrollRegion label="Largest independent expenditures" className="mt-2">
        <table className="w-full text-sm sm:min-w-[30rem]">
          <thead>
            <tr className="border-b border-control text-left text-ink-2">
              <th scope="col" className="py-2 pr-4 font-semibold">
                Spender
              </th>
              <th scope="col" className="hidden py-2 pr-4 font-semibold sm:table-cell">
                For or against
              </th>
              <th scope="col" className="hidden py-2 pr-4 font-semibold sm:table-cell">
                Date
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {outside.items.map((item) => (
              <tr
                key={item.provenance.sourceKey}
                data-expenditure={item.provenance.sourceKey}
                data-value={JSON.stringify([
                  item.spenderName,
                  item.supportOppose,
                  item.amountCents,
                  item.expenditureDate,
                ])}
                className="border-b border-rule"
              >
                <td className="py-2 pr-4">
                  {item.spenderName}
                  {item.purpose ? (
                    <span className="block text-xs text-ink-3">{item.purpose}</span>
                  ) : null}
                  <span className="mt-0.5 block text-xs text-ink-2 sm:hidden">
                    {SIDE[item.supportOppose]} · {formatDate(item.expenditureDate) ?? 'No date'}
                  </span>
                </td>
                <td className="hidden py-2 pr-4 sm:table-cell">{SIDE[item.supportOppose]}</td>
                <td className="num hidden py-2 pr-4 whitespace-nowrap text-ink-2 sm:table-cell">
                  {formatDate(item.expenditureDate) ?? 'No date'}
                </td>
                <td className="num py-2 text-right whitespace-nowrap">
                  {formatCents(item.amountCents)}
                  <SourceMark notes={notes} n={notes.cite(item.provenance)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </details>
  );
}
