'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Quick navigations finish before this delay and show nothing. */
const SHOW_AFTER_MS = 150;
/** A navigation that never lands must not leave the bar up. */
const GIVE_UP_AFTER_MS = 15_000;

/**
 * A thin accent line at the top of the window while the next page renders on the server.
 * Decorative for assistive technology: the new page's title and content are the announcement.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the URL changing is what ends a navigation
  useEffect(() => {
    setPending(false);
    setVisible(false);
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const next = new URL(anchor.href, window.location.href);
      const here = window.location;
      if (next.origin !== here.origin) return;
      if (next.pathname === here.pathname && next.search === here.search) return;
      setPending(true);
    };
    // Capture phase: next/link cancels the click's default action before it bubbles here.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const show = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    const giveUp = setTimeout(() => {
      setPending(false);
      setVisible(false);
    }, GIVE_UP_AFTER_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  return visible ? <div aria-hidden="true" className="nav-progress" /> : null;
}
