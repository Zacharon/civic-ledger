import { NoData } from '@/components/no-data';
import { formatShare } from '@/lib/format';

/** Inline 0–100% meter with its value as text. Neutral ink: a share is not good or bad. */
export function ShareBar({ share, empty = 'No data' }: { share: number | null; empty?: string }) {
  const text = formatShare(share);
  if (share === null || text === null) return <NoData>{empty}</NoData>;
  const width = `${Math.min(Math.max(share, 0), 1) * 100}%`;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="num w-10 text-right">{text}</span>
      <svg width="48" height="6" aria-hidden="true" className="shrink-0 overflow-visible">
        <rect width="100%" height="6" rx="1" className="fill-sunk" />
        <rect width={width} height="6" rx="1" className="fill-bar" />
      </svg>
    </span>
  );
}
