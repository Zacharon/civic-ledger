import type { CapabilityOutput } from '@civic-ledger/core';
import Link from 'next/link';
import { ReceiptsStack } from '@/components/charts/receipts-stack';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatCents, formatDate, formatShare } from '@/lib/format';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
import { IndustryFigure } from './industry-figure';
import { OutsideSpending } from './outside-spending';
import { Figure, ProfileSection } from './section';

export async function MoneySection({ slug, cycle }: { slug: string; cycle: number | null }) {
  const [money, sources] = await Promise.all([
    read('money.summary', cycle ? { slug, cycle } : { slug }),
    sourceInfos(),
  ]);
  const notes = new SourceNotes('money', sources);
  const { totals, industryCoding, industries, topCommittees, outsideSpending } = money;

  if (money.cycle === null || totals === null) {
    return (
      <ProfileSection id="money" title="Money">
        <p className="text-ink-2">
          No FEC campaign totals are on file for {money.person.fullName}. Members who did not run
          for federal office in a loaded cycle have none.
        </p>
      </ProfileSection>
    );
  }

  const totalsMark = notes.cite(totals.provenance);
  const asOf = totals.coverageEndDate
    ? `, covering through ${formatDate(totals.coverageEndDate)}`
    : '';

  return (
    <ProfileSection
      id="money"
      title="Money"
      lede={
        <>
          FEC filings for the <span className="num">{money.cycle}</span> election cycle
          {asOf}. Amounts are what the campaign reported.
        </>
      }
    >
      {money.availableCycles.length > 1 ? (
        <nav aria-label="Election cycle" className="-mt-2 mb-6 flex flex-wrap gap-2 text-sm">
          {money.availableCycles.map((c) => (
            <Link
              key={c}
              href={`/people/${slug}?cycle=${c}#money`}
              aria-current={c === money.cycle ? 'page' : undefined}
              className={`num inline-flex min-h-9 items-center rounded-control border px-3 ${
                c === money.cycle
                  ? 'border-accent bg-accent-wash font-semibold'
                  : 'border-control hover:border-ink-2'
              }`}
            >
              {c}
            </Link>
          ))}
        </nav>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 sm:gap-x-8">
        <div data-stat="raised" data-value={JSON.stringify(totals.totalReceiptsCents)}>
          <dt className="text-sm text-ink-2">Raised</dt>
          <dd className="rule-total mt-1 inline-block pb-0.5 text-xl font-semibold sm:text-2xl">
            {formatCents(totals.totalReceiptsCents)}
            <SourceMark notes={notes} n={totalsMark} />
          </dd>
        </div>
        <Stat label="Spent" cents={totals.totalDisbursementsCents} />
        <Stat label="Cash on hand" cents={totals.cashOnHandCents} />
        <Stat label="Debts" cents={totals.debtsCents} />
      </dl>

      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <Figure
          title="Where the money came from"
          caption={
            <>
              Source: FEC candidate summary {totals.fecCandidateId}
              <SourceMark notes={notes} n={totalsMark} />.
            </>
          }
        >
          <ReceiptsStack totals={totals} />
          <SmallDollarNote smallDollar={money.smallDollar} notes={notes} />
        </Figure>

        <IndustryFigure coding={industryCoding} industries={industries} />
      </div>

      {topCommittees.length > 0 ? (
        <div className="mt-12">
          <h3 className="font-semibold">Largest contributing committees</h3>
          <ScrollRegion label="Largest contributing committees" className="mt-3">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-control text-left text-ink-2">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Committee
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Industry
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {topCommittees.map((c) => (
                  <tr key={c.fecCommitteeId} className="border-b border-rule">
                    <td className="py-2 pr-4">
                      {c.name} <span className="num text-xs text-ink-3">{c.fecCommitteeId}</span>
                    </td>
                    <td className="py-2 pr-4 text-ink-2">
                      {c.industry?.name ?? <span className="text-ink-3">Not coded</span>}
                    </td>
                    <td className="num py-2 text-right">{formatCents(c.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
      ) : null}

      <OutsideSpending outside={outsideSpending} notes={notes} />

      <SourceList notes={notes} />
    </ProfileSection>
  );
}

function Stat({ label, cents }: { label: string; cents: number | null }) {
  const value = formatCents(cents);
  return (
    <div data-stat={label} data-value={JSON.stringify(cents)}>
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="num mt-1 text-xl sm:text-2xl">
        {value ?? <span className="text-base text-ink-3">No data</span>}
      </dd>
    </div>
  );
}

/**
 * The FEC candidate summary carries the itemized / unitemized split weball lacks, for its
 * own filing period (DECISIONS A31), so it is stated beside the stack, never inside it.
 */
function SmallDollarNote({
  smallDollar,
  notes,
}: {
  smallDollar: CapabilityOutput<'money.summary'>['smallDollar'];
  notes: SourceNotes;
}) {
  if (!smallDollar) {
    return (
      <p className="mt-4 text-sm text-ink-3">
        No FEC candidate summary on file, so the small-donor share is unknown.
      </p>
    );
  }
  const asOf = formatDate(smallDollar.coverageEndDate);
  return (
    <p className="mt-4 text-sm text-ink-2">
      <span className="font-semibold text-ink">Small donors</span> (unitemized, $200 or less):{' '}
      {smallDollar.share === null ? (
        <span className="text-ink-3">not computable from the filing</span>
      ) : (
        <>
          <span className="num font-semibold text-ink">{formatShare(smallDollar.share)}</span> of{' '}
          <span className="num">{formatCents(smallDollar.totalReceiptsCents)}</span> raised
        </>
      )}
      {asOf ? ` through ${asOf}` : ''}
      <SourceMark notes={notes} n={notes.cite(smallDollar.provenance)} />.
    </p>
  );
}
