import { formatSigned } from '@/lib/format';

const MIN = -1;
const MAX = 1;

/**
 * Ideology by position, never color: a dot on a hairline axis from −1 to +1
 * (DW-NOMINATE's range). Poles are labeled by the caller as the method defines them.
 */
export function PositionStrip({
  value,
  width = 72,
  showValue = true,
}: {
  value: number;
  width?: number;
  showValue?: boolean;
}) {
  const pad = 5;
  const clamped = Math.min(Math.max(value, MIN), MAX);
  const x = pad + ((clamped - MIN) / (MAX - MIN)) * (width - pad * 2);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {showValue ? <span className="num w-12 text-right">{formatSigned(value)}</span> : null}
      <svg width={width} height="12" aria-hidden="true" className="shrink-0">
        <line x1={pad} x2={width - pad} y1="6" y2="6" className="stroke-control" strokeWidth="1" />
        <line
          x1={width / 2}
          x2={width / 2}
          y1="2"
          y2="10"
          className="stroke-control"
          strokeWidth="1"
        />
        <circle cx={x} cy="6" r="4" className="fill-ink stroke-surface" strokeWidth="2" />
      </svg>
    </span>
  );
}
