'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/compare', label: 'Compare' },
  { href: '/races', label: 'Races' },
  { href: '/policy', label: 'Policy areas' },
  { href: '/frameworks', label: 'Frameworks' },
  { href: '/sources', label: 'Sources' },
  { href: '/methodology', label: 'Methodology' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="relative -mx-1 min-w-0 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] lg:[mask-image:none]"
    >
      <ul className="flex items-center gap-1 pr-12 whitespace-nowrap text-[0.9375rem] lg:gap-3 lg:pr-0">
        {LINKS.map(({ href, label }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center px-1.5 transition-colors duration-150 focus-visible:outline-offset-[-2px] ${
                  current
                    ? 'font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[8px]'
                    : 'text-ink-2 hover:text-ink hover:underline hover:decoration-rule hover:decoration-2 hover:underline-offset-[8px]'
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
