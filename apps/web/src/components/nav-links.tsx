'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/compare', label: 'Compare' },
  { href: '/policy', label: 'Policy areas' },
  { href: '/frameworks', label: 'Frameworks' },
  { href: '/sources', label: 'Sources' },
  { href: '/methodology', label: 'Methodology' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-1 min-w-0 flex-1 overflow-x-auto">
      <ul className="flex items-center gap-1 whitespace-nowrap text-sm">
        {LINKS.map(({ href, label }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-control px-2.5 transition-colors duration-150 ${
                  current
                    ? 'font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[6px]'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
