import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { formatNumber } from '@/lib/format';

/** Page links (work without JavaScript). `hrefFor(page)` builds each URL. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
  label = 'Pages',
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const window = pageWindow(page, pages);

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-ink-2">
        <span className="num">
          {formatNumber(first)}–{formatNumber(last)}
        </span>{' '}
        of <span className="num">{formatNumber(total)}</span>
      </p>
      {pages > 1 ? (
        <ul className="flex items-center gap-1">
          <li>
            <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page">
              <ChevronLeft aria-hidden="true" strokeWidth={1.75} className="size-4" />
            </PageLink>
          </li>
          {window.map((p, i) =>
            p === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity
              <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-ink-3">
                …
              </li>
            ) : (
              <li key={p}>
                <Link
                  href={hrefFor(p)}
                  scroll={false}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  className={`num inline-flex size-11 items-center justify-center rounded-control ${
                    p === page
                      ? 'bg-accent font-semibold text-accent-ink'
                      : 'text-ink-2 hover:bg-sunk hover:text-ink'
                  }`}
                >
                  {p}
                </Link>
              </li>
            ),
          )}
          <li>
            <PageLink href={page < pages ? hrefFor(page + 1) : null} label="Next page">
              <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-4" />
            </PageLink>
          </li>
        </ul>
      ) : null}
    </nav>
  );
}

function PageLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const className = 'inline-flex size-11 items-center justify-center rounded-control';
  if (!href) {
    return (
      <span aria-disabled="true" className={`${className} text-ink-3 opacity-50`}>
        {children}
        <span className="sr-only">{label} (not available)</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      className={`${className} text-ink-2 hover:bg-sunk hover:text-ink`}
    >
      {children}
      <span className="sr-only">{label}</span>
    </Link>
  );
}

/** 1 … 4 5 [6] 7 8 … 20 */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return [1, ...(start > 2 ? [null] : []), ...middle, ...(end < pages - 1 ? [null] : []), pages];
}
