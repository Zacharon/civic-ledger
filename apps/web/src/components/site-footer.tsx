import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { read } from '@/server/capabilities';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-10 text-sm text-ink-2 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-prose space-y-2">
          <p className="font-serif text-lg text-ink">Civic Ledger</p>
          <p>
            A non-partisan record of public data. Every number links to its source; every score
            names who made it and how.
          </p>
          <Suspense fallback={null}>
            <Freshness />
          </Suspense>
        </div>
        <nav aria-label="About the data">
          <ul className="space-y-2">
            <li>
              <Link className="link" href="/sources">
                Sources and coverage
              </Link>
            </li>
            <li>
              <Link className="link" href="/methodology">
                Methodology
              </Link>
            </li>
            <li>
              <Link className="link" href="/frameworks">
                Frameworks
              </Link>
            </li>
          </ul>
        </nav>
        <div className="space-y-2">
          <p className="font-semibold text-ink">For agents and developers</p>
          <p>
            Every view here uses the same public capabilities available as JSON at{' '}
            <code className="text-ink">/api/v1</code> and as MCP tools.
          </p>
        </div>
      </div>
    </footer>
  );
}

async function Freshness() {
  try {
    const status = await read('sources.status', {});
    const refreshed = formatDate(status.readModelRefreshedAt);
    if (!refreshed) return <p>No data has been loaded yet.</p>;
    return (
      <p>
        Tables last rebuilt{' '}
        <time dateTime={status.readModelRefreshedAt ?? undefined}>{refreshed}</time> from{' '}
        {status.sources.length} {status.sources.length === 1 ? 'source' : 'sources'}.
      </p>
    );
  } catch {
    // The footer never takes a page down; the page itself reports data errors.
    return null;
  }
}
