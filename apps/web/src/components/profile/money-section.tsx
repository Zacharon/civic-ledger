import Link from 'next/link';
import { BarList } from '@/components/charts/bar-list';
import { ReceiptsStack } from '@/components/charts/receipts-stack';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatCents, formatDate, formatShare } from '@/lib/format';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
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

      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-ink-2">Raised</dt>
          <dd className="rule-total mt-1 inline-block pb-0.5 text-2xl font-semibold">
            {formatCents(totals.totalReceiptsCents)}
            <SourceMark notes={notes} n={totalsMark} />
          </dd>
        </div>
        <Stat label="Spent" value={formatCents(totals.totalDisbursementsCents)} />
        <Stat label="Cash on hand" value={formatCents(totals.cashOnHandCents)} />
        <Stat label="Debts" value={formatCents(totals.debtsCents)} />
      </dl>

      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <Figure
          title="Where the money came from"
          caption={
            <>
              Source: FEC candidate summary {totals.fecCandidateId}
              <SourceMark notes={notes} n={totalsMark} />. Small-dollar = unitemized gifts from
              donors giving $200 or less.
            </>
          }
        >
          <ReceiptsStack totals={totals} />
        </Figure>

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
          {industryCoding.totalCents === 0 ? (
            <p className="text-sm text-ink-2">No itemized PAC contributions this cycle.</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-2">
                <span className="num font-semibold text-ink">
                  {formatShare(industryCoding.coverage)}
                </span>{' '}
                of <span className="num">{formatCents(industryCoding.totalCents)}</span> in PAC
                contributions is coded to an industry.
              </p>
              <BarList
                label="PAC contributions by industry"
                items={[
                  ...industries.map((i) => ({
                    key: i.industry.id,
                    label: (
                      <>
                        {i.industry.name}
                        <span className="text-ink-3"> · {i.industry.sector}</span>
                      </>
                    ),
                    value: i.amountCents,
                    display: (
                      <>
                        {formatCents(i.amountCents)}{' '}
                        <span className="text-ink-3">{formatShare(i.share)}</span>
                      </>
                    ),
                  })),
                  ...(industryCoding.uncodedCents > 0
                    ? [
                        {
                          key: 'not-coded',
                          label: 'Not coded',
                          value: industryCoding.uncodedCents,
                          display: (
                            <>
                              {formatCents(industryCoding.uncodedCents)}{' '}
                              <span className="text-ink-3">
                                {formatShare(
                                  industryCoding.uncodedCents / industryCoding.totalCents,
                                )}
                              </span>
                            </>
                          ),
                          muted: true,
                        },
                      ]
                    : []),
                ]}
              />
            </>
          )}
        </Figure>
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

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Figure
          title="Outside spending"
          caption="Independent expenditures reported to the FEC by groups not controlled by the campaign."
        >
          {outsideSpending.items.length === 0 ? (
            <p className="text-sm text-ink-2">No independent expenditures reported this cycle.</p>
          ) : (
            <BarList
              label="Outside spending for and against"
              items={[
                {
                  key: 'support',
                  label: 'For this member',
                  value: outsideSpending.supportCents,
                  display: formatCents(outsideSpending.supportCents),
                },
                {
                  key: 'oppose',
                  label: 'Against this member',
                  value: outsideSpending.opposeCents,
                  display: formatCents(outsideSpending.opposeCents),
                },
              ]}
            />
          )}
        </Figure>
        {outsideSpending.items.length > 0 ? (
          <ScrollRegion label="Independent expenditures">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">Independent expenditures</caption>
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
                {outsideSpending.items.map((item) => (
                  <tr key={item.provenance.sourceKey} className="border-b border-rule">
                    <td className="py-2 pr-4">
                      {item.spenderName}
                      {item.purpose ? (
                        <span className="block text-xs text-ink-3">{item.purpose}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      {item.supportOppose === 'support' ? 'For' : 'Against'}
                    </td>
                    <td className="num py-2 pr-4 text-ink-2">
                      {formatDate(item.expenditureDate) ?? 'No date'}
                    </td>
                    <td className="num py-2 text-right">
                      {formatCents(item.amountCents)}
                      <SourceMark notes={notes} n={notes.cite(item.provenance)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : null}
      </div>

      <SourceList notes={notes} />
    </ProfileSection>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="num mt-1 text-2xl">
        {value ?? <span className="text-base text-ink-3">No data</span>}
      </dd>
    </div>
  );
}
