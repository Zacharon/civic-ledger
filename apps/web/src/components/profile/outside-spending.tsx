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
          <p className="text-sm text-ink-2">No independent expenditures reported this cycle.</p>
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
          <h3 className="font-semibold">
            By spender{' '}
            <span className="font-normal text-ink-3">
              (<span className="num">{formatNumber(outside.spenders.length)}</span> spenders,{' '}
              <span className="num">{formatNumber(outside.itemCount)}</span> expenditures)
            </span>
          </h3>
          <ScrollRegion label="Outside spending by spender" className="mt-3">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-control text-left text-ink-2">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Spender
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    For or against
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">
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
                    className="border-b border-rule"
                  >
                    <td className="py-2 pr-4">
                      {s.spenderName}
                      <span className="block text-xs text-ink-3">
                        <span className="num">{s.spenderFecCommitteeId}</span>
                        {s.latestDate ? ` · latest ${formatDate(s.latestDate)}` : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{SIDE[s.supportOppose]}</td>
                    <td className="num py-2 pr-4 text-right">{formatNumber(s.expenditures)}</td>
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
      <summary className="link cursor-pointer">
        The {formatNumber(outside.items.length)} largest single expenditures, with sources
      </summary>
      <ScrollRegion label="Largest independent expenditures" className="mt-2">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b border-control text-left text-ink-2">
              <th scope="col" className="py-2 pr-4 font-semibold">
                Spender
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                For or against
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                Date
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {outside.items.map((item) => (
              <tr key={item.provenance.sourceKey} className="border-b border-rule">
                <td className="py-2 pr-4">
                  {item.spenderName}
                  {item.purpose ? (
                    <span className="block text-xs text-ink-3">{item.purpose}</span>
                  ) : null}
                </td>
                <td className="py-2 pr-4">{SIDE[item.supportOppose]}</td>
                <td className="num py-2 pr-4 whitespace-nowrap text-ink-2">
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
