'use client';

import { Search, X } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { type ColumnDef, IDENTITY_SORTS } from '@/lib/explore-columns';
import { exploreParsers, PAGE_SIZES, scopeOf, serializeExplore } from '@/lib/explore-params';
import { changesBeforeHydration } from '@/lib/explore-pending';
import { formatNumber } from '@/lib/format';
import { ColumnPicker } from './column-picker';
import { useExploreTransition } from './explore-transition';
import { UrlActionButton } from './url-action-button';

interface Facet<T extends string = string> {
  value: T;
  count: number;
}

export interface ExploreFacets {
  scopes: { current: number; all: number };
  chambers: Facet<'house' | 'senate'>[];
  states: Facet[];
  parties: Facet[];
  districts?: { state: string; district: number; count: number }[];
}

const CHAMBER_LABEL = { house: 'House', senate: 'Senate' } as const;
const SEARCH_DELAY_MS = 350;
/** "Clear filters" resets what is filtered and keeps how it is viewed (sort, columns, rows). */
const NO_FILTERS = {
  q: null,
  scope: null,
  chamber: null,
  state: null,
  district: null,
  party: null,
  page: null,
};

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
  const ids = {
    form: useId(),
    q: useId(),
    state: useId(),
    district: useId(),
    party: useId(),
    sort: useId(),
    size: useId(),
  };

  const [query, setQuery] = useState(state.q ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const urlQuery = state.q ?? '';
  // Back/forward navigation changes the URL under us: mirror it into the input.
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);
  // A choice made while the scripts were still loading is drawn but was never applied.
  // Declared after the mirror above so a name typed early wins over the URL's on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at hydration; later changes have handlers
  useEffect(() => {
    const patch = formRef.current ? changesBeforeHydration(formRef.current, state) : null;
    if (!patch) return;
    if (patch.q !== undefined) setQuery(patch.q ?? '');
    void setState({ ...patch, page: null });
  }, []);

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

  const scope = scopeOf(state);
  const sortValue = state.sort?.[0] ? `${state.sort[0].id}.${state.sort[0].direction}` : '';
  const sortable = columns.filter((c) => c.sortKey !== undefined);
  const districts = (facets.districts ?? []).filter((seat) => seat.state === state.state);
  const hasDistrict = state.district !== null;
  const active = [
    scope === 'all' ? { key: 'scope', label: 'Including former members' } : null,
    state.q ? { key: 'q', label: `Name contains “${state.q}”` } : null,
    state.chamber ? { key: 'chamber', label: CHAMBER_LABEL[state.chamber] } : null,
    state.state ? { key: 'state', label: `State: ${state.state}` } : null,
    hasDistrict
      ? {
          key: 'district',
          label:
            state.district === 0
              ? 'House: at-large + senators'
              : `House district ${state.district} + senators`,
        }
      : null,
    state.party ? { key: 'party', label: `Party: ${state.party}` } : null,
  ].filter((f) => f !== null);

  return (
    <div className="space-y-4">
      <search>
        <form
          ref={formRef}
          id={ids.form}
          action="/explore"
          onSubmit={onSubmit}
          className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-3 lg:gap-x-4 xl:grid-cols-[minmax(10rem,1.2fr)_auto_auto_minmax(6rem,0.5fr)_minmax(8rem,0.7fr)_minmax(8rem,0.7fr)]"
        >
          <div className="col-span-2 flex flex-col gap-1.5 lg:col-span-1">
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
                placeholder="Last or full name"
                autoComplete="off"
                maxLength={100}
                className="field w-full pl-9"
              />
            </div>
          </div>

          <fieldset className="col-span-2 flex flex-col gap-1.5 lg:col-span-1">
            <legend className="mb-1.5 text-sm font-semibold">Members</legend>
            <Segmented
              name="scope"
              options={[
                {
                  value: 'current',
                  label: 'Current',
                  count: facets.scopes.current,
                  title: 'Current members of Congress',
                },
                {
                  value: 'all',
                  label: 'Include former',
                  count: facets.scopes.all,
                  title: 'Include former members',
                },
              ]}
              selected={scope}
              onSelect={(value) =>
                void setState({ scope: value === 'all' ? 'all' : null, page: null })
              }
            />
          </fieldset>

          <fieldset className="col-span-2 flex flex-col gap-1.5 lg:col-span-1">
            <legend className="mb-1.5 text-sm font-semibold">Chamber</legend>
            <div className="flex h-11 rounded-control border border-control bg-surface p-0.5 lg:inline-flex">
              {[
                { value: null, label: 'Both' },
                ...facets.chambers.map((c) => ({ value: c.value, label: CHAMBER_LABEL[c.value] })),
              ].map((option) => {
                const checked = state.chamber === option.value;
                return (
                  <label
                    key={option.label}
                    className={`relative inline-flex flex-1 cursor-pointer items-center justify-center rounded-[3px] px-3.5 text-sm lg:flex-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.state} className="text-sm font-semibold">
              State
            </label>
            <select
              id={ids.state}
              name="state"
              value={state.state ?? ''}
              onChange={(e) =>
                void setState({ state: e.target.value || null, district: null, page: null })
              }
              className="field w-full min-w-0"
            >
              <option value="">All states</option>
              {facets.states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value} ({s.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.district} className="text-sm font-semibold">
              House district
            </label>
            <select
              id={ids.district}
              name="district"
              className="field w-full min-w-0"
              disabled={!state.state}
              value={state.district ?? ''}
              onChange={(event) =>
                void setState({
                  district: event.target.value === '' ? null : Number(event.target.value),
                  page: null,
                })
              }
            >
              <option value="">All districts</option>
              {hasDistrict && !districts.some((seat) => seat.district === state.district) ? (
                <option value={state.district ?? ''}>
                  {state.district === 0 ? 'At-large' : `District ${state.district}`} (no seat
                  loaded)
                </option>
              ) : null}
              {districts.map((seat) => (
                <option key={seat.district} value={seat.district}>
                  {seat.district === 0 ? 'At-large' : `District ${seat.district}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-3">
              {state.state
                ? 'Includes senators when both chambers are shown.'
                : 'Choose a state to select a district.'}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.party} className="text-sm font-semibold">
              Party
            </label>
            <select
              id={ids.party}
              name="party"
              value={state.party ?? ''}
              onChange={(e) => void setState({ party: e.target.value || null, page: null })}
              className="field w-full min-w-0"
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
            <li className="text-sm text-ink-3">No filters. Showing every current member.</li>
          ) : (
            <>
              {active.map((f) => (
                <li key={f.key}>
                  <UrlActionButton
                    href={serializeExplore('/explore', {
                      ...state,
                      [f.key]: null,
                      ...(f.key === 'state' ? { district: null } : {}),
                      page: null,
                    })}
                    onActivate={() =>
                      void setState({
                        [f.key]: null,
                        ...(f.key === 'state' ? { district: null } : {}),
                        page: null,
                      })
                    }
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-control bg-accent-wash px-2.5 text-sm hover:border-ink-2"
                  >
                    {f.label}
                    <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                    <span className="sr-only">(remove filter)</span>
                  </UrlActionButton>
                </li>
              ))}
              <li>
                <UrlActionButton
                  href={serializeExplore('/explore', { ...state, ...NO_FILTERS })}
                  onActivate={() => {
                    setQuery('');
                    void setState(NO_FILTERS);
                  }}
                  className="link min-h-9 px-1 text-sm"
                >
                  Clear filters
                </UrlActionButton>
              </li>
            </>
          )}
        </ul>

        <div className="grid w-full grid-cols-2 items-end gap-3 sm:flex sm:w-auto">
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.sort} className="text-sm font-semibold">
              Sort by
            </label>
            <select
              id={ids.sort}
              name="sort"
              form={ids.form}
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
              className="field w-full sm:max-w-[19rem]"
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
              name="size"
              form={ids.form}
              value={state.size}
              onChange={(e) => {
                const size = PAGE_SIZES.find((s) => s === Number(e.target.value));
                if (size) void setState({ size, page: null });
              }}
              className="field w-full sm:w-auto"
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

interface SegmentedOption {
  value: string;
  label: string;
  count: number;
  title: string;
}

/** Radio group drawn as one segmented control; every option shows its count. */
function Segmented({
  name,
  options,
  selected,
  onSelect,
}: {
  name: string;
  options: SegmentedOption[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex h-11 rounded-control border border-control bg-surface p-0.5 lg:inline-flex">
      {options.map((option) => {
        const checked = selected === option.value;
        return (
          <label
            key={option.value}
            className={`relative inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] px-3 text-sm whitespace-nowrap lg:flex-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
              checked ? 'bg-accent font-semibold text-accent-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onSelect(option.value)}
              aria-label={`${option.title} (${formatNumber(option.count)})`}
              className="sr-only"
            />
            {option.label}
            <span aria-hidden="true" className={`num text-xs ${checked ? '' : 'text-ink-3'}`}>
              {formatNumber(option.count)}
            </span>
          </label>
        );
      })}
    </div>
  );
}
