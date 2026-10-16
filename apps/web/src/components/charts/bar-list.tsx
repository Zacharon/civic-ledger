import type { ReactNode } from 'react';

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  display: ReactNode;
  /** Neutral "not coded" / "other" styling. */
  muted?: boolean;
}

/** Ranked horizontal bars on one zero-based scale, every value printed as text. */
export function BarList({ items, label }: { items: BarListItem[]; label: string }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul aria-label={label} className="space-y-2.5">
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1"
        >
          <span className={`min-w-0 text-sm ${item.muted ? 'text-ink-3' : 'text-ink'}`}>
            {item.label}
          </span>
          <span className="num text-sm text-ink">{item.display}</span>
          <svg className="col-span-2 block h-2 w-full" aria-hidden="true">
            <rect width="100%" height="8" rx="1" className="fill-sunk" />
            <rect
              width={`${max > 0 ? (item.value / max) * 100 : 0}%`}
              height="8"
              rx="1"
              className={item.muted ? 'fill-data-other' : 'fill-bar'}
            />
          </svg>
        </li>
      ))}
    </ul>
  );
}
