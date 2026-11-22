'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type KeyboardEvent, useEffect, useRef } from 'react';

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/compare', label: 'Compare' },
  { href: '/races', label: 'Races' },
  { href: '/policy', label: 'Policy areas' },
  { href: '/frameworks', label: 'Frameworks' },
  { href: '/sources', label: 'Sources' },
  { href: '/methodology', label: 'Methodology' },
] as const;

/**
 * One line from 768px. Below that, a native <details> menu shows every destination at once
 * (seven links never fit a phone row) and works before hydration and without JavaScript.
 */
export function NavLinks() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closes the menu after each navigation
  useEffect(() => {
    menu.current?.removeAttribute('open');
  }, [pathname]);

  const closeOnEscape = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== 'Escape' || !menu.current?.open) return;
    menu.current.removeAttribute('open');
    menu.current.querySelector('summary')?.focus();
  };

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Main" className="min-w-0">
      <details ref={menu} className="nav-menu md:hidden" onKeyDown={closeOnEscape}>
        <summary>
          <Menu aria-hidden="true" strokeWidth={1.75} className="size-4" />
          Menu
        </summary>
        <ul className="grid grid-cols-2 gap-x-4 border-t border-rule pt-1 text-base">
          {LINKS.map(({ href, label }) => (
            <li key={href} className="border-b border-rule">
              <Link
                href={href}
                aria-current={isCurrent(href) ? 'page' : undefined}
                className={`flex min-h-11 items-center ${
                  isCurrent(href)
                    ? 'font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4'
                    : 'text-ink-2'
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </details>
      <div className="-mx-1 hidden overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] md:block lg:[mask-image:none]">
        <ul className="flex items-center gap-1 pr-12 whitespace-nowrap text-[0.9375rem] lg:gap-3 lg:pr-0">
          {LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isCurrent(href) ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center px-1.5 transition-colors duration-150 focus-visible:outline-offset-[-2px] ${
                  isCurrent(href)
                    ? 'font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[8px]'
                    : 'text-ink-2 hover:text-ink hover:underline hover:decoration-rule hover:decoration-2 hover:underline-offset-[8px]'
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
