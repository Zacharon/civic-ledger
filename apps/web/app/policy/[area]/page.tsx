import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TallyBar } from '@/components/charts/tally-bar';
import { FullTitle } from '@/components/full-title';
import { Pagination } from '@/components/pagination';
import { PartyChip } from '@/components/party-chip';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import {
  formatDate,
  formatNumber,
  formerLabel,
  ordinal,
  rollCallNumber,
  safeHref,
  seatLabel,
  shortTitle,
} from '@/lib/format';
import { POSITION_LABEL } from '@/lib/labels';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';

const MATRIX_ROLLCALLS = 10;
const MATRIX_PAGE = 100;
const POSITION_SHORT = { yea: 'Y', nay: 'N', present: 'P', not_voting: '–' } as const;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function findArea(id: string) {
  const areas = await read('policy.areas', {});
  return areas.items.find((a) => a.id === id) ?? null;
}

export async function generateMetadata({ params }: PageProps<'/policy/[area]'>): Promise<Metadata> {
  const area = await findArea((await params).area);
  return { title: area ? `${area.name} votes` : 'Policy area not found' };
}

export default async function PolicyAreaPage({
  params,
  searchParams,
}: PageProps<'/policy/[area]'>) {
  const [{ area: areaId }, query] = await Promise.all([params, searchParams]);
  const area = await findArea(areaId);
  if (!area) notFound();

  const [house, senate, sources] = await Promise.all([
    read('votes.list', { policyArea: area.id, chamber: 'house', limit: MATRIX_ROLLCALLS }),
    read('votes.list', { policyArea: area.id, chamber: 'senate', limit: MATRIX_ROLLCALLS }),
    sourceInfos(),
  ]);
  const requested = first(query.chamber);
  const chamber =
    requested === 'senate' || requested === 'house'
      ? requested
      : house.total >= senate.total
        ? 'house'
        : 'senate';
  const votes = chamber === 'house' ? house : senate;
  const page = Math.max(1, Number.parseInt(first(query.page) ?? '1', 10) || 1);
  const notes = new SourceNotes('policy', sources);

  // "How every member voted": the same rollcalls scored through frameworks.evaluate,
  // read only for positions (the alignment numbers are not shown on this page).
  const matrix =
    votes.items.length > 0
      ? await read('frameworks.evaluate', {
          framework: {
            title: `${area.name} roll calls`,
            rules: votes.items.map((v) => ({
              target: {
                kind: 'rollcall' as const,
                congress: v.rollcall.congress,
                chamber: v.rollcall.chamber,
                number: v.rollcall.number,
              },
              alignedPosition: 'yea' as const,
            })),
          },
          people: { chamber },
          limit: MATRIX_PAGE,
          offset: (page - 1) * MATRIX_PAGE,
        })
      : null;
  const hrefFor = (next: { chamber?: string; page?: number }) => {
    const params = new URLSearchParams();
    params.set('chamber', next.chamber ?? chamber);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/policy/${area.id}?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link href="/policy" className="link">
          Policy areas
        </Link>{' '}
        / <span aria-current="page">{area.name}</span>
      </nav>
      <header
        className="mt-4 max-w-3xl"
        data-area={area.id}
        data-value={JSON.stringify([area.billCount, area.rollcallCount, house.total, senate.total])}
      >
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">{area.name}</h1>
        <p className="mt-3 text-ink-2">
          <span className="num">{formatNumber(area.billCount)}</span> bills and{' '}
          <span className="num">{formatNumber(area.rollcallCount)}</span> roll calls in this
          Congress.gov policy area. Most recent first.
        </p>
      </header>

      <nav aria-label="Chamber" className="mt-8 flex gap-2">
        {(['house', 'senate'] as const).map((c) => (
          <Link
            key={c}
            href={hrefFor({ chamber: c })}
            aria-current={c === chamber ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-control border px-4 text-sm ${
              c === chamber
                ? 'border-accent bg-accent-wash font-semibold'
                : 'border-control text-ink-2 hover:border-ink-2'
            }`}
          >
            {c === 'house' ? 'House' : 'Senate'}{' '}
            <span className="num ml-1.5 text-ink-3">{(c === 'house' ? house : senate).total}</span>
          </Link>
        ))}
      </nav>

      {votes.items.length === 0 ? (
        <p className="mt-8 text-ink-2">
          No {chamber === 'house' ? 'House' : 'Senate'} roll calls in this area yet.
        </p>
      ) : (
        <>
          <section aria-labelledby="key-votes" className="mt-10">
            <h2 id="key-votes" className="font-serif text-2xl font-medium">
              Roll calls
            </h2>
            <ol className="mt-4 divide-y divide-rule border-y border-rule">
              {votes.items.map((v, i) => {
                const billHref = safeHref(v.bill?.url);
                return (
                  <li
                    key={v.rollcall.number}
                    data-rollcall={`${v.rollcall.chamber}.${v.rollcall.congress}.${v.rollcall.number}`}
                    data-value={JSON.stringify([v.tally.yea, v.tally.nay, v.rollcall.result])}
                    className="grid gap-4 py-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-10"
                  >
                    <div>
                      <p className="num text-xs text-ink-3">
                        <span className="font-semibold text-ink-2">R{i + 1}</span> ·{' '}
                        {formatDate(v.rollcall.voteDate)} · {ordinal(v.rollcall.congress)} Congress
                        · {chamber === 'house' ? 'House' : 'Senate'} roll call{' '}
                        {rollCallNumber(v.rollcall)}
                      </p>
                      <h3 className="mt-1 font-serif text-lg leading-snug">
                        {v.bill ? (
                          billHref ? (
                            <a className="link-quiet" href={billHref} rel="noreferrer">
                              {shortTitle(v.bill.title).text}
                            </a>
                          ) : (
                            shortTitle(v.bill.title).text
                          )
                        ) : (
                          v.rollcall.question
                        )}
                      </h3>
                      {v.bill ? <FullTitle title={v.bill.title} /> : null}
                      <p className="mt-1 text-sm text-ink-2">
                        {v.rollcall.question}:{' '}
                        <span className="font-semibold text-ink">{v.rollcall.result}</span>
                        <SourceMark notes={notes} n={notes.cite(v.rollcall.provenance)} />
                      </p>
                    </div>
                    <div>
                      <TallyBar tally={v.tally} />
                      {v.byParty.length > 0 ? (
                        <table className="mt-3 w-full text-xs">
                          <caption className="sr-only">Positions by party</caption>
                          <thead>
                            <tr className="text-ink-3">
                              <th scope="col" className="py-1 text-left font-semibold">
                                Party
                              </th>
                              <th scope="col" className="py-1 text-right font-semibold">
                                Yea
                              </th>
                              <th scope="col" className="py-1 text-right font-semibold">
                                Nay
                              </th>
                              <th scope="col" className="py-1 text-right font-semibold">
                                Other
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {v.byParty.map((p) => (
                              <tr key={p.party} className="border-t border-rule">
                                <th scope="row" className="py-1 text-left font-normal">
                                  <PartyChip party={p.party} />{' '}
                                  <span className="text-ink-2">{p.party}</span>
                                </th>
                                <td className="num py-1 text-right">{p.yea}</td>
                                <td className="num py-1 text-right">{p.nay}</td>
                                <td className="num py-1 text-right text-ink-2">
                                  {p.present + p.notVoting}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {matrix ? (
            <section aria-labelledby="every-member" className="mt-14">
              <h2 id="every-member" className="font-serif text-2xl font-medium">
                How every member voted
              </h2>
              <p className="mt-1.5 text-sm text-ink-2">
                Y = yea, N = nay, P = present, – = not voting. Columns R1–R{votes.items.length} are
                the roll calls above.
              </p>
              <section
                className="relative mt-4 max-h-[70dvh] overflow-auto rounded-panel border border-rule bg-surface"
                aria-label="Member positions"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard reachable
                tabIndex={0}
              >
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <caption className="sr-only">Every member’s position on each roll call</caption>
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky top-0 left-0 z-[3] border-b border-control bg-sunk px-3 py-2 text-left font-semibold"
                      >
                        Member
                      </th>
                      {votes.items.map((v, i) => (
                        <th
                          key={v.rollcall.number}
                          scope="col"
                          className="num sticky top-0 z-[2] border-b border-control bg-sunk px-2 py-2 text-center font-semibold"
                          title={v.bill?.title ?? v.rollcall.question}
                        >
                          R{i + 1}
                          <span className="sr-only">
                            : {shortTitle(v.bill?.title ?? v.rollcall.question).text}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.results.map((r) => (
                      <tr
                        key={r.person.slug}
                        data-slug={r.person.slug}
                        data-value={JSON.stringify(
                          votes.items.map(
                            (_, i) => r.votes.find((x) => x.ruleIndex === i)?.position ?? null,
                          ),
                        )}
                        className="group"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-[1] border-b border-rule bg-surface px-3 py-2 text-left font-normal whitespace-nowrap group-hover:bg-sunk"
                        >
                          <Link
                            href={`/people/${r.person.slug}`}
                            className="link-quiet font-medium"
                          >
                            {r.person.fullName}
                          </Link>{' '}
                          <PartyChip party={r.person.party} />{' '}
                          <span className="text-xs text-ink-3">
                            {seatLabel(r.person.chamber, r.person.state, r.person.district)}
                            {r.person.isCurrent ? '' : ` · ${formerLabel(r.person, 'Former')}`}
                          </span>
                        </th>
                        {votes.items.map((v, i) => {
                          const cast = r.votes.find((x) => x.ruleIndex === i);
                          return (
                            <td
                              key={v.rollcall.number}
                              className="num border-b border-rule px-2 py-2 text-center group-hover:bg-sunk/60"
                            >
                              {cast ? (
                                <>
                                  <span
                                    aria-hidden="true"
                                    className={cast.position === 'nay' ? 'font-semibold' : ''}
                                  >
                                    {POSITION_SHORT[cast.position]}
                                  </span>
                                  <span className="sr-only">{POSITION_LABEL[cast.position]}</span>
                                </>
                              ) : (
                                <span className="text-ink-3">
                                  <span aria-hidden="true">·</span>
                                  <span className="sr-only">Not a member at the time</span>
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {matrix.total > MATRIX_PAGE ? (
                <div className="mt-4">
                  <Pagination
                    page={page}
                    pageSize={MATRIX_PAGE}
                    total={matrix.total}
                    hrefFor={(p) => hrefFor({ page: p })}
                    label="Member pages"
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <section
        aria-labelledby="industry-money"
        className="mt-14 max-w-3xl border-t border-rule pt-6"
      >
        <h2 id="industry-money" className="font-semibold">
          Money from related industries
        </h2>
        <p className="mt-1.5 text-sm text-ink-2">
          Not shown yet. Linking a policy area to industries needs a reviewed mapping, and the
          ledger will not guess one. Each member’s PAC money by industry is on their profile.
        </p>
      </section>
      <SourceList notes={notes} />
    </div>
  );
}
