import type { CSSProperties } from 'react';
import { formatNumber } from '@/lib/format';
import { summarizeTally, type Tally } from '@/lib/vote';

/**
 * How a roll call split: a part-to-whole meter with every category's label and count
 * printed beside it, and the denominator stated. Colors come only from the vote tokens
 * (teal Yea, amber Nay, hatched Present, grey Not voting); never from party.
 */
export function TallyBar({ tally, size = 'sm' }: { tally: Tally; size?: 'sm' | 'lg' }) {
  const { total, parts, segments } = summarizeTally(tally);
  return (
    <div data-tally-total={total}>
      {total === 0 ? (
        <p className="text-sm text-ink-3">No positions recorded for this roll call.</p>
      ) : (
        <div className={`vote-meter ${size === 'lg' ? 'vote-meter-lg' : ''}`} aria-hidden="true">
          {segments.map((s) => (
            <span key={s.key} className={s.className} style={{ '--n': s.count } as CSSProperties} />
          ))}
        </div>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5" data-vote={p.key}>
            <span className={`vote-key ${p.className}`} aria-hidden="true" />
            {p.label} <span className="num font-semibold text-ink">{formatNumber(p.count)}</span>
          </li>
        ))}
      </ul>
      {total > 0 ? (
        <p className="mt-1 text-sm text-ink-3">
          Of <span className="num">{formatNumber(total)}</span> recorded positions.
        </p>
      ) : null}
    </div>
  );
}
