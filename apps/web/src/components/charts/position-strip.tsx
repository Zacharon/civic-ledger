import type { CSSProperties } from 'react';
import { formatSigned } from '@/lib/format';

const MIN = -1;
const MAX = 1;

/**
 * Ideology by position, never color: a dot on a hairline axis from −1 to +1
 * (DW-NOMINATE's range), drawn in CSS (see `.pos` in globals.css). Callers label the
 * poles as the method defines them.
 */
export function PositionStrip({
  value,
  width = 56,
  showValue = true,
}: {
  value: number;
  width?: number;
  showValue?: boolean;
}) {
  const clamped = Math.min(Math.max(value, MIN), MAX);
  const style = {
    '--x': `${Math.round(((clamped - MIN) / (MAX - MIN)) * 1000) / 10}%`,
    ...(width === 56 ? {} : { '--w': `${width}px` }),
  } as CSSProperties;
  return (
    <span className={showValue ? 'pos' : 'pos pos-bare'} style={style}>
      {showValue ? formatSigned(value) : null}
    </span>
  );
}
