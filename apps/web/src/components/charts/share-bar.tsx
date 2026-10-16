import type { CSSProperties } from 'react';
import { NoData } from '@/components/no-data';
import { formatShare } from '@/lib/format';

/** Inline 0–100% meter with its value as text. Neutral ink: a share is not good or bad. */
export function ShareBar({ share, empty = 'No data' }: { share: number | null; empty?: string }) {
  const text = formatShare(share);
  if (share === null || text === null) return <NoData>{empty}</NoData>;
  const style = {
    '--v': `${Math.round(Math.min(Math.max(share, 0), 1) * 1000) / 10}%`,
  } as CSSProperties;
  return (
    <span className="share" style={style}>
      {text}
    </span>
  );
}
