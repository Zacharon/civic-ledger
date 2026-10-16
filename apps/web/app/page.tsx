import { ArrowRight, Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MetricCell } from '@/components/explore/cell';
import { PartyChip } from '@/components/party-chip';
import { columnById } from '@/lib/explore-columns';
import { serializeExplore } from '@/lib/explore-params';
import { formatDate, formatNumber, formatShare, seatLabel } from '@/lib/format';
import { read } from '@/server/capabilities';

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
  const [table, status, areas, frameworks] = await Promise.all([
    read('explore.table', { limit: 4 }),
    read('sources.status', {}),
    read('policy.areas', {}),
    read('frameworks.list', {}),
  ]);
  const preview = PREVIEW_COLUMNS.flatMap((id) => {
    const column = columnById(id, table.scorecardColumns);
    return column ? [column] : [];
  });

  return (
    <>
      <section className="mx-auto grid max-w-[1440px] gap-12 px-4 pt-12 pb-16 sm:px-6 md:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-16">
        <div className="max-w-2xl">
          <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-[3.5rem] sm:leading-[1.05]">
            The public record of Congress, in one table.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-2">
            Campaign money, roll-call votes, independent scores and promises for every member. Each
            number links to its source.
          </p>

          <search className="mt-8 block max-w-xl">
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
                    placeholder="Name, e.g. Ashvale"
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

        <figure className="self-start rounded-panel border border-rule bg-surface">
          <figcaption className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-3 text-sm">
            <span className="font-semibold">From the ledger</span>
            <span className="text-ink-3">Default order: state, then name</span>
          </figcaption>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="px-4 py-2 font-semibold">
                  Member
                </th>
                {preview.map((c) => (
                  <th key={c.id} scope="col" className="px-4 py-2 text-right font-semibold">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.slug} className="border-t border-rule">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link href={`/people/${row.slug}`} className="link-quiet">
                      {row.fullName}
                    </Link>
                    <span className="mt-1 flex items-center gap-2 text-xs font-normal text-ink-3">
                      <PartyChip party={row.party} />
                      {seatLabel(row.chamber, row.state, row.district)}
                    </span>
                  </th>
                  {preview.map((c) => (
                    <td key={c.id} className="px-4 py-3 text-right whitespace-nowrap">
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
              <span className="num font-semibold text-ink">{formatNumber(table.total)}</span>{' '}
              members in the table
            </span>
            <Link href="/explore" className="link font-semibold">
              Open the full table
            </Link>
          </p>
        </figure>
      </section>

      <section aria-labelledby="freshness" className="border-y border-rule bg-surface">
        <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
          <h2 id="freshness" className="sr-only">
            Data freshness
          </h2>
          <dl className="grid gap-x-10 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {status.sources.map((source) => (
              <div key={source.id}>
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
              <dd className="mt-0.5 text-ink-2">
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

      <section aria-labelledby="inside" className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
        <h2 id="inside" className="font-serif text-2xl font-medium">
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
            <span className="num">{areas.items.length}</span> Congress.gov areas, and how each
            member voted.
          </Entry>
          <Entry term="Ideology and scorecards" href="/methodology#scores">
            DW-NOMINATE from Voteview beside{' '}
            <span className="num">{table.scorecardColumns.length}</span> published scorecards, each
            with the publisher’s own stated orientation.
          </Entry>
          <Entry term="Promises and platforms" href="/methodology#promises">
            Campaign promises with dated ratings and evidence, and stated positions next to the
            voting record. Curated and reviewed in public.
          </Entry>
          <Entry term="Frameworks" href="/frameworks">
            <span className="num">{frameworks.items.length}</span> attributed frameworks, or build
            your own: “aligned X of Y” with every vote listed. One view, never a neutral score.
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
