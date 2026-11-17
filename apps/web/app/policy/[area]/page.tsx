import type { CapabilityOutput } from '@civic-ledger/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PartyBreakdown } from '@/components/charts/party-breakdown';
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
import { VOTE_KEY_CLASS } from '@/lib/vote';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
import { STATE_GLYPH, STATE_LABEL, STATE_LEGEND } from './member-states';

const MATRIX_ROLLCALLS = 10;
const MATRIX_PAGE = 100;
const CHAMBER_NAME = { house: 'House', senate: 'Senate' } as const;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

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

  // "How every member voted": the same rollcalls through frameworks.evaluate, read only for
  // each member's state per roll call (the alignment numbers are not shown on this page).
  // Membership is vote-time: anyone who voted in this chamber then, even if since moved.
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
          people: { chamber, basis: 'at_vote' as const },
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
    <div className="page-frame pt-8 sm:pt-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link href="/policy" className="link">
          Policy areas
        </Link>{' '}
        / <span aria-current="page">{area.name}</span>
      </nav>
      <header
        className="mt-6 max-w-3xl"
        data-area={area.id}
        data-value={JSON.stringify([area.billCount, area.rollcallCount, house.total, senate.total])}
      >
        <p className="eyebrow">Policy area · Congress.gov taxonomy</p>
        <h1 className="page-title mt-3">{area.name}</h1>
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
            <h2 id="key-votes" className="section-title">
              Roll calls
            </h2>
            <ol className="mt-4 divide-y divide-rule border-t border-ink border-b border-b-rule">
              {votes.items.map((v, i) => {
                const billHref = safeHref(v.bill?.url);
                return (
                  <li
                    key={v.rollcall.number}
                    data-rollcall={`${v.rollcall.chamber}.${v.rollcall.congress}.${v.rollcall.number}`}
                    data-value={JSON.stringify([v.tally.yea, v.tally.nay, v.rollcall.result])}
                    data-source={JSON.stringify([
                      v.sourceTally.yea,
                      v.sourceTally.nay,
                      v.tallyCheck.status,
                      v.ambiguousTermPositions,
                    ])}
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
                      <TallyCheck vote={v} />
                      <PartyBreakdown byParty={v.byParty} tally={v.tally} placement="list" />
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {matrix ? (
            <section aria-labelledby="every-member" className="mt-14">
              <h2 id="every-member" className="section-title">
                How every member voted
              </h2>
              <p className="mt-1.5 max-w-3xl text-sm text-ink-2">
                Everyone who voted in the {CHAMBER_NAME[chamber]} on the roll calls above (columns
                R1–R{votes.items.length}), judged by the terms they held on each vote date, so
                members who have since left or changed chamber are included. Party and seat next to
                a name are current; “voted as” shows a different party held on the vote date.
              </p>
              <ul
                aria-label="Legend"
                className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2"
              >
                {STATE_LEGEND.map((state) => (
                  <li key={state} data-state={state} className="inline-flex items-center gap-1.5">
                    {state === 'not_serving' || state === 'unavailable' ? (
                      <span
                        aria-hidden="true"
                        className="num inline-block w-4 text-center text-ink-3"
                      >
                        {STATE_GLYPH[state]}
                      </span>
                    ) : (
                      <>
                        <span aria-hidden="true" className={`vote-key ${VOTE_KEY_CLASS[state]}`} />
                        <span aria-hidden="true" className="num font-semibold text-ink">
                          {STATE_GLYPH[state]}
                        </span>
                      </>
                    )}{' '}
                    {STATE_LABEL[state]}
                  </li>
                ))}
              </ul>
              <section
                className="relative mt-4 max-h-[70dvh] overflow-auto border-y border-ink bg-surface"
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
                    {matrix.results.map((r) => {
                      const states = votes.items.map((_, i) =>
                        r.rollcallStates.find((x) => x.ruleIndex === i),
                      );
                      const votedAs = [
                        ...new Set(
                          states.flatMap((s) =>
                            s?.partyAtVote && s.partyAtVote !== r.person.party
                              ? [s.partyAtVote]
                              : [],
                          ),
                        ),
                      ];
                      const nowIn =
                        r.person.chamber !== null && r.person.chamber !== chamber
                          ? CHAMBER_NAME[r.person.chamber]
                          : null;
                      return (
                        <tr
                          key={r.person.slug}
                          data-slug={r.person.slug}
                          data-value={JSON.stringify(
                            votes.items.map(
                              (_, i) => r.votes.find((x) => x.ruleIndex === i)?.position ?? null,
                            ),
                          )}
                          data-states={JSON.stringify(states.map((s) => s?.state ?? null))}
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
                            <span className="sr-only">Current party: </span>
                            <PartyChip party={r.person.party} />{' '}
                            <span className="text-xs text-ink-3">
                              {nowIn ? `Now ${nowIn} · ` : ''}
                              {seatLabel(r.person.chamber, r.person.state, r.person.district)}
                              {r.person.isCurrent ? '' : ` · ${formerLabel(r.person, 'Former')}`}
                              {votedAs.length > 0 ? ` · voted as ${votedAs.join(', ')}` : ''}
                            </span>
                          </th>
                          {votes.items.map((v, i) => {
                            const state = states[i]?.state;
                            return (
                              <td
                                key={v.rollcall.number}
                                data-state={state ?? undefined}
                                className="num border-b border-rule px-2 py-2 text-center group-hover:bg-sunk/60"
                              >
                                {state ? (
                                  <span
                                    className={
                                      state === 'not_serving' || state === 'unavailable'
                                        ? 'text-ink-3'
                                        : 'inline-flex items-center gap-1 font-semibold'
                                    }
                                  >
                                    {state === 'not_serving' || state === 'unavailable' ? null : (
                                      <span
                                        aria-hidden="true"
                                        className={`vote-key ${VOTE_KEY_CLASS[state]}`}
                                      />
                                    )}
                                    <span aria-hidden="true">{STATE_GLYPH[state]}</span>
                                    <span className="sr-only">{STATE_LABEL[state]}</span>
                                  </span>
                                ) : (
                                  <span className="text-ink-3">
                                    <span aria-hidden="true">·</span>
                                    <span className="sr-only">Roll call not resolved</span>
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
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

/**
 * The tally above is rebuilt from stored member positions; this line compares it with
 * the totals the source recorded on the roll call, and never presents a gap as complete.
 */
function TallyCheck({ vote }: { vote: CapabilityOutput<'votes.list'>['items'][number] }) {
  const { sourceTally, tallyCheck, ambiguousTermPositions } = vote;
  return (
    <p className="mt-2 text-xs text-ink-2" data-tally-check={tallyCheck.status}>
      {tallyCheck.status === 'matches_source' ? (
        <>
          Matches the source totals ({formatNumber(sourceTally.yea)} yea,{' '}
          {formatNumber(sourceTally.nay)} nay).
        </>
      ) : (
        <>
          <span className="font-semibold text-ink">Differs from the source totals</span>:{' '}
          {formatNumber(sourceTally.yea)} yea, {formatNumber(sourceTally.nay)} nay on the roll call
          record. The counts above come from stored member positions (yea{' '}
          {signed(tallyCheck.yeaDifference)}, nay {signed(tallyCheck.nayDifference)}), so they are
          incomplete or coded differently; paired votes count as not voting here.
        </>
      )}
      {ambiguousTermPositions > 0 ? (
        <>
          {' '}
          {formatNumber(ambiguousTermPositions)}{' '}
          {ambiguousTermPositions === 1 ? 'position' : 'positions'} matched more than one term on
          the vote date; each counts once, under the latest-starting term’s party.
        </>
      ) : null}
    </p>
  );
}
