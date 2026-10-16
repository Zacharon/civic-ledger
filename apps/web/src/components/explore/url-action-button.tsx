'use client';

import type { FormEvent, ReactNode } from 'react';

/**
 * A button that moves to `href` (same path, new query) even before React hydrates: it is
 * the submit button of a GET form whose hidden fields are `href`'s query. Once hydrated,
 * `onActivate` runs instead (a client-side URL update), so the action is never lost while
 * the page's scripts are still loading (H3-06).
 */
export function UrlActionButton({
  href,
  onActivate,
  className,
  children,
}: {
  href: string;
  onActivate: () => void;
  className?: string;
  children: ReactNode;
}) {
  const url = new URL(href, 'http://local.invalid');
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onActivate();
  };
  return (
    <form action={url.pathname} method="get" onSubmit={onSubmit} className="contents">
      {[...url.searchParams].map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
