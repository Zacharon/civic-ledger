'use client';

import { Search, X } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { type ColumnDef, IDENTITY_SORTS } from '@/lib/explore-columns';
import { exploreParsers, PAGE_SIZES } from '@/lib/explore-params';
import { ColumnPicker } from './column-picker';
import { useExploreTransition } from './explore-transition';

interface Facet<T extends string = string> {
  value: T;
  count: number;
}

export interface ExploreFacets {
  chambers: Facet<'house' | 'senate'>[];
  states: Facet[];
  parties: Facet[];
}

const CHAMBER_LABEL = { house: 'House', senate: 'Senate' } as const;
const SEARCH_DELAY_MS = 350;

/** Filters, sort, page size and columns. Every change is a URL change (shareable). */
export function ExploreControls({
  facets,
  columns,
}: {
  facets: ExploreFacets;
  columns: ColumnDef[];
}) {
  const { startTransition } = useExploreTransition();
  const [state, setState] = useQueryStates(exploreParsers, {
    shallow: false,
    history: 'push',
    scroll: false,
    startTransition,
  });
  const ids = { q: useId(), state: useId(), party: useId(), sort: useId(), size: useId() };

  const [query, setQuery] = useState(state.q ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const urlQuery = state.q ?? '';
  // Back/forward navigation changes the URL under us: mirror it into the input.
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const commitQuery = (value: string) => {
    clearTimeout(timer.current);
    const next = value.trim();
    if (next === (state.q ?? '')) return;
    void setState({ q: next || null, page: null });
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commitQuery(value), SEARCH_DELAY_MS);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitQuery(query);
  };

  const sortValue = state.sort?.[0] ? `${state.sort[0].id}.${state.sort[0].direction}` : '';
  const sortable = columns.filter((c) => c.sortKey !== undefined);
  const active = [
    state.q ? { key: 'q', label: `Name contains “${state.q}”` } : null,
    state.chamber ? { key: 'chamber', label: CHAMBER_LABEL[state.chamber] } : null,
    state.state ? { key: 'state', label: `State: ${state.state}` } : null,
    state.party ? { key: 'party', label: `Party: ${state.party}` } : null,
  ].filter((f) => f !== null);

  return (
    <div className="space-y-4">
      <search>
        <form
          action="/explore"
          onSubmit={onSubmit}
          className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1.4fr)_auto_minmax(8rem,0.6fr)_minmax(10rem,0.8fr)]"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.q} className="text-sm font-semibold">
              Name
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              />
              <input
                id={ids.q}
                name="q"
                type="search"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="e.g. Ashvale"
                autoComplete="off"
                maxLength={100}
                className="field w-full pl-9"
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-semibold">Chamber</legend>
            <div className="inline-flex h-11 rounded-control border border-control bg-surface p-0.5">
              {[
                { value: null, label: 'Both' },
                ...facets.chambers.map((c) => ({ value: c.value, label: CHAMBER_LABEL[c.value] })),
              ].map((option) => {
                const checked = state.chamber === option.value;
                return (
                  <label
                    key={option.label}
                    className={`relative inline-flex cursor-pointer items-center rounded-[3px] px-3.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                      checked
                        ? 'bg-accent font-semibold text-accent-ink'
                        : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    <input
                      type="radio"
                      name="chamber"
                      value={option.value ?? ''}
                      checked={checked}
                      onChange={() => void setState({ chamber: option.value, page: null })}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.state} className="text-sm font-semibold">
              State
            </label>
            <select
              id={ids.state}
              name="state"
              value={state.state ?? ''}
              onChange={(e) => void setState({ state: e.target.value || null, page: null })}
              className="field"
            >
              <option value="">All states</option>
              {facets.states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value} ({s.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.party} className="text-sm font-semibold">
              Party
            </label>
            <select
              id={ids.party}
              name="party"
              value={state.party ?? ''}
              onChange={(e) => void setState({ party: e.target.value || null, page: null })}
              className="field"
            >
              <option value="">All parties</option>
              {facets.parties.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value} ({p.count})
                </option>
              ))}
            </select>
          </div>
          <noscript>
            <button type="submit" className="btn btn-secondary">
              Apply filters
            </button>
          </noscript>
        </form>
      </search>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-rule pt-4">
        <ul className="flex min-h-11 flex-wrap items-center gap-2" aria-label="Active filters">
          {active.length === 0 ? (
            <li className="text-sm text-ink-3">No filters. Showing every member.</li>
          ) : (
            <>
              {active.map((f) => (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={() => void setState({ [f.key]: null, page: null })}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-control bg-accent-wash px-2.5 text-sm hover:border-ink-2"
                  >
                    {f.label}
                    <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                    <span className="sr-only">(remove filter)</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    void setState({ q: null, chamber: null, state: null, party: null, page: null });
                  }}
                  className="link min-h-9 px-1 text-sm"
                >
                  Clear filters
                </button>
              </li>
            </>
          )}
        </ul>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.sort} className="text-sm font-semibold">
              Sort by
            </label>
            <select
              id={ids.sort}
              value={sortValue}
              onChange={(e) => {
                const [id, direction] = e.target.value.split('.');
                void setState({
                  sort:
                    id && (direction === 'asc' || direction === 'desc')
                      ? [{ id, direction }]
                      : null,
                  page: null,
                });
              }}
              className="field max-w-[19rem]"
            >
              <option value="">State, then name (default)</option>
              <option value="name.asc">Name, A to Z</option>
              <option value="name.desc">Name, Z to A</option>
              <option value="party.asc">{IDENTITY_SORTS.party.label}, A to Z</option>
              {sortable.map((c) => (
                <optgroup key={c.id} label={c.label}>
                  <option value={`${c.id}.desc`}>{c.label}, high to low</option>
                  <option value={`${c.id}.asc`}>{c.label}, low to high</option>
                </optgroup>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.size} className="text-sm font-semibold">
              Rows
            </label>
            <select
              id={ids.size}
              value={state.size}
              onChange={(e) => {
                const size = PAGE_SIZES.find((s) => s === Number(e.target.value));
                if (size) void setState({ size, page: null });
              }}
              className="field"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <ColumnPicker columns={columns} />
        </div>
      </div>
    </div>
  );
}
