import type { ReactNode } from 'react';

/**
 * Wraps a wide table that may scroll sideways on small screens. Scrollable regions
 * must be reachable and named for keyboard and screen-reader users (WCAG 2.1.1).
 * `relative` contains absolutely positioned descendants (`sr-only` text): without it they
 * escape the clipping and widen the whole page on small screens.
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
      className={`relative overflow-x-auto ${className}`}
    >
      {children}
    </section>
  );
}
