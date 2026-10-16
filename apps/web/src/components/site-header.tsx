import Link from 'next/link';
import { NavLinks } from './nav-links';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur-sm supports-[backdrop-filter]:bg-paper/85">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="group shrink-0" aria-label="Civic Ledger, home">
          <span className="rule-total block pb-0.5 font-serif text-xl font-medium leading-none tracking-tight">
            Civic Ledger
          </span>
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
