import { ArrowRight, Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SeatChart } from '@/components/charts/seat-chart';
import { MetricCell, metricValue } from '@/components/explore/cell';
import { MemberFinder } from '@/components/home/member-finder';
import { PartyChip } from '@/components/party-chip';
import { SourceList, SourceNotes } from '@/components/sources';
import { columnById } from '@/lib/explore-columns';
import { serializeExplore } from '@/lib/explore-params';
import { formatDate, formatNumber, formatShare, seatLabel } from '@/lib/format';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';

const EXAMPLES = [
  {
    question: 'Which senators get the largest share of their money from PACs?',
    href: serializeExplore('/explore', {
      chamber: 'senate',
      sort: [{ id: 'pac', direction: 'desc' }],
      cols: ['total', 'pac', 'small', 'industries'],
    }),
  },
  {
    question: 'Who in the House misses the most roll-call votes?',
    href: serializeExplore('/explore', {
      chamber: 'house',
      sort: [{ id: 'missed', direction: 'desc' }],
      cols: ['missed', 'eligible', 'tenure'],
    }),
  },
  {
    question: 'Who raises the most from small-dollar donors?',
    href: serializeExplore('/explore', {
      sort: [{ id: 'small', direction: 'desc' }],
      cols: ['total', 'small', 'pac'],
    }),
  },
] as const;

const PREVIEW_COLUMNS = ['total', 'pac', 'missed'] as const;

export default async function HomePage() {
  const [table, facets, status, areas, frameworks, composition, sources] = await Promise.all([
    read('explore.table', { limit: 4 }),
    read('explore.facets', {}),
    read('sources.status', {}),
    read('policy.areas', {}),
    read('frameworks.list', {}),
    read('chamber.composition', {}),
    sourceInfos(),
  ]);
  const seatNotes = new SourceNotes('seats', sources);
  const seatMark = seatNotes.cite(composition.provenance);
  const preview = PREVIEW_COLUMNS.flatMap((id) => {
    const column = columnById(id, table.scorecardColumns);
    return column ? [column] : [];
  });

  return (
    <>
      <section className="page-frame grid grid-cols-1 gap-12 pt-10 pb-16 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-16">
        <div className="min-w-0 max-w-2xl">
          <h1 className="page-title">The public record of Congress, in one table.</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-2">
            Explore campaign money, roll-call votes and sourced statements for{' '}
            <span
              className="num"
              data-facet="current"
              data-value={JSON.stringify(facets.scopes.current)}
            >
              {formatNumber(facets.scopes.current)}
            </span>{' '}
            current members, with former members one click away. Each number links to its source;
            coverage varies by section.
          </p>

          <search aria-label="Home member search" className="mt-8 block max-w-xl">
            <form action="/explore">
              <label htmlFor="home-search" className="text-sm font-semibold">
                Find a member of Congress
              </label>
              <div className="mt-1.5 flex gap-2">
                <div className="relative flex-1">
                  <Search
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3"
                  />
                  <input
                    id="home-search"
                    name="q"
                    type="search"
                    required
                    maxLength={100}
                    autoComplete="off"
                    placeholder="Last or full name"
                    className="field h-12 w-full pl-11 text-lg"
                  />
                </div>
                <button type="submit" className="btn btn-primary h-12 px-5 text-base">
                  Search
                </button>
              </div>
            </form>
          </search>

          <div className="mt-10 max-w-xl">
            <h2 className="text-sm font-semibold">Or start from a question</h2>
            <ul className="mt-2 divide-y divide-rule border-y border-rule">
              {EXAMPLES.map((example) => (
                <li key={example.href}>
                  <Link
                    href={example.href}
                    className="group flex min-h-12 items-center justify-between gap-4 py-3 font-serif text-lg leading-snug hover:text-accent"
                  >
                    {example.question}
                    <ArrowRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <figure className="min-w-0 self-start rounded-panel border border-rule bg-surface">
          <figcaption className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-3 text-sm">
            <span className="font-semibold">From the ledger</span>
            <span className="text-ink-3">Default order: state, name</span>
          </figcaption>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="py-2 pr-2 pl-3 font-semibold sm:px-4">
                  Member
                </th>
                {preview.map((c, i) => (
                  <th
                    key={c.id}
                    scope="col"
                    className={`py-2 pr-3 pl-2 text-right font-semibold sm:px-4 ${i > 1 ? 'hidden sm:table-cell' : ''}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.slug} data-slug={row.slug} className="border-t border-rule">
                  <th scope="row" className="py-3 pr-2 pl-3 text-left font-medium sm:px-4">
                    <Link href={`/people/${row.slug}`} className="link-quiet">
                      {row.fullName}
                    </Link>
                    <span className="mt-1 flex items-center gap-2 text-xs font-normal text-ink-3">
                      <PartyChip party={row.party} />
                      {seatLabel(row.chamber, row.state, row.district)}
                    </span>
                  </th>
                  {preview.map((c, i) => (
                    <td
                      key={c.id}
                      data-column={c.id}
                      data-value={metricValue(c, row)}
                      className={`py-3 pr-3 pl-2 text-right whitespace-nowrap sm:px-4 ${i > 1 ? 'hidden sm:table-cell' : ''}`}
                    >
                      <MetricCell column={c} row={row} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rule-total mx-4" />
          <p className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-ink-2">
              <span
                className="num font-semibold text-ink"
                data-total
                data-value={JSON.stringify(table.total)}
              >
                {formatNumber(table.total)}
              </span>{' '}
              current members of Congress
            </span>
            <Link href="/explore" className="link font-semibold">
              Open the full table
            </Link>
          </p>
        </figure>
      </section>

      <MemberFinder />

      <section aria-labelledby="seats-title" className="page-frame pb-12">
        <div className="rule-strong pt-6">
          <h2 id="seats-title" className="section-title">
            Who serves now
          </h2>
          <p className="mt-1.5 max-w-3xl text-ink-2">
            Current members of each chamber by party as of {formatDate(composition.asOf)}, one
            square per voting seat. Party color is used here and in party chips only.
          </p>
          <div className="mt-6">
            <SeatChart composition={composition} notes={seatNotes} mark={seatMark} />
          </div>
          <p className="mt-6 max-w-3xl text-sm text-ink-3" data-seat-order>
            Squares run in this order: {composition.partyOrder} The order is alphabetical, not a
            ranking. Current means the member’s latest term covers the as-of date, by the party on
            that term.
          </p>
          <SourceList notes={seatNotes} />
        </div>
      </section>

      <section aria-labelledby="freshness" className="border-y border-rule bg-surface">
        <div className="page-frame py-6">
          <h2 id="freshness" className="sr-only">
            Data freshness
          </h2>
          <dl className="grid gap-x-10 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {status.sources.map((source) => (
              <div
                key={source.id}
                data-source={source.id}
                data-value={JSON.stringify([
                  source.lastSuccess?.finishedAt ?? source.lastSuccess?.startedAt ?? null,
                  source.lastRun?.status ?? null,
                ])}
              >
                <dt className="font-semibold">{source.name}</dt>
                <dd className="mt-0.5 text-ink-2">
                  {source.lastSuccess ? (
                    <>
                      Last loaded{' '}
                      <time
                        dateTime={source.lastSuccess.finishedAt ?? source.lastSuccess.startedAt}
                      >
                        {formatDate(source.lastSuccess.finishedAt ?? source.lastSuccess.startedAt)}
                      </time>
                    </>
                  ) : (
                    'Not loaded yet'
                  )}
                  {source.lastRun && source.lastRun.status !== 'succeeded'
                    ? `. Latest run ${source.lastRun.status}.`
                    : null}
                </dd>
              </div>
            ))}
            <div>
              <dt className="font-semibold">Industry coding coverage</dt>
              <dd
                className="mt-0.5 text-ink-2"
                data-coverage
                data-value={JSON.stringify(status.coverage.industryCoding.coverage)}
              >
                {formatShare(status.coverage.industryCoding.coverage) ?? 'No PAC data yet'} of PAC
                dollars coded; the rest shows as “not coded”.
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm">
            <Link href="/sources" className="link">
              Every source, its terms and its last run
            </Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="inside" className="page-frame py-16">
        <h2 id="inside" className="section-title">
          What the ledger holds
        </h2>
        <dl className="mt-6 grid gap-x-12 border-t border-rule md:grid-cols-2">
          <Entry
            term="Money"
            href="/explore?cols=total,pac,small,coverage,outsideFor,outsideAgainst"
          >
            FEC receipts by who gave, PAC money by industry with its coding coverage, and outside
            spending for and against.
          </Entry>
          <Entry term="Votes" href="/policy">
            Every roll call with the bill, its policy area across{' '}
            <span className="num" data-areas data-value={JSON.stringify(areas.items.length)}>
              {areas.items.length}
            </span>{' '}
            Congress.gov areas, and how each member voted.
          </Entry>
          <Entry term="Ideology and scorecards" href="/methodology#scores">
            {table.scorecardColumns.length > 0 ? (
              <>
                DW-NOMINATE from Voteview beside{' '}
                <span
                  className="num"
                  data-scorecards
                  data-value={JSON.stringify(table.scorecardColumns.length)}
                >
                  {table.scorecardColumns.length}
                </span>{' '}
                published scorecards, each with the publisher’s own stated orientation.
              </>
            ) : (
              <>
                DW-NOMINATE from Voteview. Published interest-group scorecards appear beside it,
                with each publisher’s own stated orientation, once their terms of use are cleared.
              </>
            )}
          </Entry>
          <Entry term="Promises and platforms" href="/methodology#promises">
            Campaign promises with dated ratings and evidence, and stated positions next to the
            voting record. Curated and reviewed in public.
          </Entry>
          <Entry term="Frameworks" href="/frameworks">
            {frameworks.items.length > 0 ? (
              <>
                <span
                  className="num"
                  data-frameworks
                  data-value={JSON.stringify(frameworks.items.length)}
                >
                  {frameworks.items.length}
                </span>{' '}
                attributed frameworks, or build your own
              </>
            ) : (
              'Build your own framework from any roll calls'
            )}
            : “aligned X of Y” with every vote listed. One view, never a neutral score.
          </Entry>
          <Entry term="Compare" href="/compare">
            Two to four members side by side, with how often they voted the same way.
          </Entry>
        </dl>
      </section>
    </>
  );
}

function Entry({ term, href, children }: { term: string; href: string; children: ReactNode }) {
  return (
    <div className="border-b border-rule py-5">
      <dt>
        <Link href={href} className="link-quiet font-semibold">
          {term}
        </Link>
      </dt>
      <dd className="mt-1 text-ink-2">{children}</dd>
    </div>
  );
}
