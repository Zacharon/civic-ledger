import { Search } from 'lucide-react';
import Link from 'next/link';
import { NavLinks } from './nav-links';

/**
 * Masthead: wordmark, main navigation and member search on a 2px ink rule.
 * Search is an ordinary GET to Explore's name filter (`explore.table` `q`), the same
 * command as the Home search box and `/api/v1/explore.table?q=`. It stays visible at
 * every width; on phones it takes its own full-width row.
 */
export function SiteHeader() {
  return (
    <header className="page-frame">
      <div className="rule-strong-bottom grid grid-cols-[minmax(0,1fr)] items-center gap-x-10 gap-y-3 pt-5 pb-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:py-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 justify-self-start"
          aria-label="Civic Ledger, home"
        >
          <span className="wordmark">Civic Ledger</span>
          <span aria-hidden="true" className="mt-1.5 size-[7px] rounded-full bg-accent" />
        </Link>
        <NavLinks />
        <search aria-label="Site" className="block w-full lg:w-64 xl:w-72">
          <form action="/explore" className="relative">
            <label htmlFor="site-search" className="sr-only">
              Search members by name
            </label>
            <Search
              aria-hidden="true"
              strokeWidth={1.75}
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <input
              id="site-search"
              name="q"
              type="search"
              required
              maxLength={100}
              autoComplete="off"
              placeholder="Search members by name"
              className="field w-full bg-transparent pl-9 text-base"
            />
          </form>
        </search>
      </div>
    </header>
  );
}
