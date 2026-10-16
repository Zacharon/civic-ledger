import { shortTitle } from '@/lib/format';

/** The complete official title, behind a disclosure, when `shortTitle` had to cut it. */
export function FullTitle({ title, max }: { title: string; max?: number }) {
  if (!shortTitle(title, max).truncated) return null;
  return (
    <details className="mt-1 text-sm text-ink-2">
      <summary className="link w-fit cursor-pointer">Full official title</summary>
      <p className="mt-1 max-w-prose">{title}</p>
    </details>
  );
}
