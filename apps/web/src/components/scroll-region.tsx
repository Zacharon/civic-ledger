import type { ReactNode } from 'react';

/**
 * Wraps a wide table that may scroll sideways on small screens. Scrollable regions
 * must be reachable and named for keyboard and screen-reader users (WCAG 2.1.1).
 */
export function ScrollRegion({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard reachable
      tabIndex={0}
      className={`overflow-x-auto ${className}`}
    >
      {children}
    </section>
  );
}
