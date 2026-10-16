import type { Metadata } from 'next';
import Link from 'next/link';
import { createLoader } from 'nuqs/server';
import { ExploreCards } from '@/components/explore/explore-cards';
import { ExploreControls } from '@/components/explore/explore-controls';
import { ExploreTable } from '@/components/explore/explore-table';
import { ExploreTransitionProvider, PendingRegion } from '@/components/explore/explore-transition';
import { Pagination } from '@/components/pagination';
import { safeHref } from '@/lib/format';
import { allColumns, visibleColumns } from '@/lib/explore-columns';
import { exploreParsers, serializeExplore } from '@/lib/explore-params';
import { describeSort, exploreTableInput, resolvedSort } from '@/lib/explore-query';
import { read, readOrInvalid } from '@/server/capabilities';

export const metadata: Metadata = {
  title: 'Explore',
  description: 'Sort and filter every member of Congress by money, votes, scores and promises.',
};

const loadExplore = createLoader(exploreParsers);

export default async function ExplorePage({ searchParams }: PageProps<'/explore'>) {
  const state = await loadExplore(searchParams);
  const [facets, result] = await Promise.all([
    read('explore.facets', {}),
    readOrInvalid('explore.table', exploreTableInput(state)),
  ]);
  const scorecards = result.ok ? result.data.scorecardColumns : [];
  const columns = visibleColumns(state.cols, scorecards);
  const sort = resolvedSort(state.sort, scorecards);
  const hrefFor = (page: number) =>
    serializeExplore('/explore', { ...state, page: page === 1 ? null : page });

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
          Every member, one table
        </h1>
        <p className="mt-3 text-ink-2">
          Money, votes, independent scores and promises side by side. Sort by any column; nothing
          is ranked for you. Missing data says so.
        </p>
      </header>

      <ExploreTransitionProvider>
        <div className="mt-8">
          <ExploreControls
            facets={facets}
            columns={allColumns(scorecards)}
          />
        </div>

        <PendingRegion>
          {!result.ok ? (
            <div role="alert" className="mt-6 rounded-panel border border-control bg-surface p-6">
              <h2 className="font-serif text-xl font-medium">This view can’t be shown</h2>
              <p className="mt-2 text-ink-2">
                {result.error.issues?.[0]?.message ?? result.error.message}.
              </p>
              <Link href="/explore" className="btn btn-secondary mt-4">
                Reset the table
              </Link>
            </div>
          ) : result.data.rows.length === 0 ? (
            <div className="mt-6 rounded-panel border border-rule bg-surface p-8 text-center">
              <h2 className="font-serif text-xl font-medium">
                {result.data.total > 0 ? 'That page does not exist' : 'No members match these filters'}
              </h2>
              <p className="mt-2 text-ink-2">
                {result.data.total > 0
                  ? 'The table is shorter than that. Go back to the first page.'
                  : 'Try a different name, or widen the chamber, state or party.'}
              </p>
              <Link
                href={result.data.total > 0 ? hrefFor(1) : '/explore'}
                className="btn btn-secondary mt-4"
              >
                {result.data.total > 0 ? 'Go to page 1' : 'Clear filters'}
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-6 mb-3 text-sm text-ink-2" aria-live="polite">
                <span className="num font-semibold text-ink">{result.data.total}</span>{' '}
                {result.data.total === 1 ? 'member' : 'members'}, sorted by{' '}
                {describeSort(sort, columns).replace(/^./, (c) => c.toLowerCase())}.
              </p>
              <div className="hidden md:block">
                <ExploreTable
                  rows={result.data.rows}
                  columns={columns}
                  state={state}
                  sort={sort}
                  caption={`Members of Congress, sorted by ${describeSort(sort, columns)}. Page ${state.page}.`}
                />
              </div>
              <div className="md:hidden">
                <ExploreCards rows={result.data.rows} columns={columns} />
              </div>
              <div className="mt-4">
                <Pagination
                  page={state.page}
                  pageSize={state.size}
                  total={result.data.total}
                  hrefFor={hrefFor}
                  label="Table pages"
                />
              </div>
            </>
          )}
        </PendingRegion>
      </ExploreTransitionProvider>

      <section aria-labelledby="explore-notes" className="mt-12 grid gap-8 border-t border-rule pt-8 text-sm text-ink-2 md:grid-cols-2">
        <h2 id="explore-notes" className="sr-only">
          How to read this table
        </h2>
        <div>
          <h3 className="font-semibold text-ink">Scorecards</h3>
          {scorecards.length === 0 ? (
            <p className="mt-1">No publisher has cleared terms for score display yet.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {scorecards.map((s) => (
                <li key={s.publisherId}>
                  {s.name}, which describes itself as {s.selfDescribedOrientation}.{' '}
                  {safeHref(s.methodologyUrl) ? (
                    <a className="link" href={safeHref(s.methodologyUrl) ?? undefined} rel="noreferrer">
                      Methodology
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-ink">DW-NOMINATE</h3>
          <p className="mt-1">
            An academic, roll-call based estimate from Voteview. The dot sits between −1 and +1:
            negative is more liberal and positive more conservative, as the method defines them. It
            is never the default sort. <Link className="link" href="/methodology#dw-nominate">How it works</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
