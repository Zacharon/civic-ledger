'use client';

import { type ReactNode, useEffect, useRef } from 'react';

/**
 * A native <details> that renders open (so it works without JavaScript and for crawlers),
 * then folds itself shut on phones after hydration. Anyone can reopen it with Enter or
 * Space on the summary. The summary is a 44px target (`.disclosure`).
 */
export function PartyDisclosure({
  summary,
  defaultOpen,
  closeOnPhone,
  children,
}: {
  summary: ReactNode;
  defaultOpen: boolean;
  closeOnPhone: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (closeOnPhone && window.matchMedia('(max-width: 767px)').matches) {
      ref.current?.removeAttribute('open');
    }
  }, [closeOnPhone]);
  return (
    <details ref={ref} open={defaultOpen} className="disclosure">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
