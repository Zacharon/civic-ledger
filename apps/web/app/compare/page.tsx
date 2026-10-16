import { CapabilityError } from '@civic-ledger/core';
import { X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShareBar } from '@/components/charts/share-bar';
import { MetricCell } from '@/components/explore/cell';
import { PartyChip } from '@/components/party-chip';
import { allColumns, COLUMN_GROUPS } from '@/lib/explore-columns';
import { chamberLabel, formatNumber, seatLabel } from '@/lib/format';
import { read } from '@/server/capabilities';

export const metadata: Metadata = {
  title: 'Compare',
  description: 'Two to four members of Congress side by side, with how often they voted alike.',
};

const MAX = 4;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseIds(value: string | undefined): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG.test(s) && s.length <= 120);
  return [...new Set(ids)].slice(0, MAX);
}

const compareHref = (ids: string[]) => (ids.length > 0 ? `/compare?ids=${ids.join(',')}` : '/compare');

export default async function ComparePage({ searchParams }: PageProps<'/compare'>) {
  const query = await searchParams;
  const ids = parseIds(first(query.ids));
  const add = first(query.add)?.trim().slice(0, 100) ?? '';

  // "Add a member": one match goes straight in; several become a choice list.
  const matches =
    add && ids.length < MAX ? await read('people.search', { q: add, limit: 8 }) : null;
  const candidates = matches?.items.filter((m) => !ids.includes(m.slug)) ?? [];
  if (matches && candidates.length === 1 && candidates[0]) {
    redirect(compareHref([...ids, candidates[0].slug]));
  }

  const comparison = ids.length >= 2 ? await compare(ids) : null;
  const scorecards = (await read('explore.table', { limit: 1 })).scorecardColumns;
  const columns = allColumns(scorecards);
  const single = ids.length === 1 && ids[0] ? await profileName(ids[0]) : null;

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">Compare members</h1>
        <p className="mt-3 text-ink-2">
          Two to four members in aligned columns, every row from the same table. Vote agreement
          counts only roll calls where both voted yea or nay.
        </p>
      </header>

      <form action="/compare" className="mt-8 flex max-w-xl flex-col gap-1.5">
        <label htmlFor="compare-add" className="text-sm font-semibold">
          Add a member{ids.length > 0 ? ` (${ids.length} of ${MAX} chosen)` : ''}
        </label>
        <div className="flex gap-2">
          <input type="hidden" name="ids" value={ids.join(',')} />
          <input
            id="compare-add"
            name="add"
            type="search"
            required
            maxLength={100}
            defaultValue={add}
            disabled={ids.length >= MAX}
            placeholder={ids.length >= MAX ? 'Remove a member to add another' : 'Name'}
            autoComplete="off"
            className="field flex-1"
          />
          <button type="submit" className="btn btn-primary" disabled={ids.length >= MAX}>
            Add
          </button>
        </div>
      </form>

      {matches ? (
        <div className="mt-4 max-w-xl" role="status">
          {candidates.length === 0 ? (
            <p className="text-ink-2">No member matches “{add}”. Check the spelling or try a last name.</p>
          ) : (
            <>
              <p className="text-sm text-ink-2">Several members match “{add}”. Choose one:</p>
              <ul className="mt-2 divide-y divide-rule border-y border-rule">
                {candidates.map((m) => (
                  <li key={m.slug}>
                    <Link
                      href={compareHref([...ids, m.slug])}
                      className="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-accent"
                    >
                      <span className="font-medium">{m.fullName}</span>
                      <span className="flex items-center gap-2 text-sm text-ink-2">
                        <PartyChip party={m.party} />
                        {seatLabel(m.chamber, m.state, m.district)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {ids.length < 2 ? (
        <div className="mt-10 rounded-panel border border-rule bg-surface p-8">
          <h2 className="font-serif text-xl font-medium">
            {ids.length === 0 ? 'Choose two to four members' : 'Add one more member to compare'}
          </h2>
          <p className="mt-2 max-w-prose text-ink-2">
            Search by name above, or open a profile and choose “Compare with others”.
            {single ? (
              <>
                {' '}
                Chosen so far: <span className="font-semibold text-ink">{single}</span>.
              </>
            ) : null}
          </p>
          <Link href="/explore" className="btn btn-secondary mt-4">
            Browse the table
          </Link>
        </div>
      ) : comparison && 'missing' in comparison ? (
        <div role="alert" className="mt-10 rounded-panel border border-control bg-surface p-6">
          <h2 className="font-serif text-xl font-medium">A member in this link was not found</h2>
          <p className="mt-2 text-ink-2">{comparison.missing}</p>
          <Link href="/compare" className="btn btn-secondary mt-4">
            Start over
          </Link>
        </div>
      ) : comparison ? (
        <>
          <div
            className="mt-10 overflow-x-auto rounded-panel border border-rule bg-surface"
            role="region"
            aria-label="Comparison table"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard reachable
            tabIndex={0}
          >
            <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">
                Side-by-side comparison of {comparison.people.map((p) => p.fullName).join(', ')}
              </caption>
              <thead>
                <tr>
                  <td className="sticky left-0 z-[1] w-48 border-b border-control bg-surface" />
                  {comparison.people.map((p) => (
                    <th
                      key={p.slug}
                      scope="col"
                      className="border-b border-l border-control border-l-rule px-4 py-4 text-left align-top font-normal"
                    >
                      <Link href={`/people/${p.slug}`} className="link-quiet font-serif text-xl font-medium">
                        {p.fullName}
                      </Link>
                      <span className="mt-1.5 flex items-center gap-2 text-ink-2">
                        <PartyChip party={p.party} />
                        {chamberLabel(p.chamber)} · {seatLabel(p.chamber, p.state, p.district)}
                      </span>
                      <Link
                        href={compareHref(ids.filter((id) => id !== p.slug))}
                        className="mt-2 inline-flex min-h-9 items-center gap-1 text-ink-3 hover:text-ink"
                      >
                        <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                        Remove<span className="sr-only"> {p.fullName}</span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              {COLUMN_GROUPS.map((group) => {
                const rows = columns.filter((c) => c.group === group.id);
                if (rows.length === 0) return null;
                return (
                  <tbody key={group.id}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={comparison.people.length + 1}
                        className="sticky left-0 border-b border-rule bg-sunk px-4 py-1.5 text-left text-xs font-semibold text-ink-3"
                      >
                        {group.label}
                      </th>
                    </tr>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <th
                          scope="row"
                          className="sticky left-0 z-[1] border-b border-rule bg-surface px-4 py-2.5 text-left font-normal text-ink-2"
                        >
                          {c.label}
                          {c.scorecard ? (
                            <span className="block text-xs text-ink-3">
                              Self-described: {c.scorecard.selfDescribedOrientation}
                            </span>
                          ) : null}
                        </th>
                        {comparison.people.map((p) => (
                          <td key={p.slug} className="border-b border-l border-rule px-4 py-2.5 [&>span]:justify-start">
                            <MetricCell column={c} row={p} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          <section aria-labelledby="agreement" className="mt-12 max-w-3xl">
            <h2 id="agreement" className="font-serif text-2xl font-medium">
              How often they voted alike
            </h2>
            <p className="mt-1.5 text-sm text-ink-2">
              Share of roll calls where both cast a yea or nay and the positions matched.
            </p>
            <ul className="mt-4 divide-y divide-rule border-y border-rule">
              {comparison.voteAgreement.map((pair) => {
                const name = (slug: string) =>
                  comparison.people.find((p) => p.slug === slug)?.fullName ?? slug;
                return (
                  <li key={`${pair.a}-${pair.b}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      {name(pair.a)} <span className="text-ink-3">and</span> {name(pair.b)}
                    </span>
                    <span className="flex items-center gap-4 text-sm text-ink-2">
                      {pair.sharedVotes === 0 ? (
                        'No shared roll calls'
                      ) : (
                        <>
                          <span className="num">
                            {formatNumber(pair.agreed)} of {formatNumber(pair.sharedVotes)}
                          </span>
                          <ShareBar share={pair.rate} />
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

async function profileName(slug: string): Promise<string | null> {
  try {
    return (await read('people.get', { slug })).person.fullName;
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'not_found') return null;
    throw error;
  }
}

async function compare(ids: string[]) {
  try {
    return await read('people.compare', { slugs: ids });
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'not_found') {
      return { missing: error.message };
    }
    throw error;
  }
}
