interface Tally {
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
}

const PARTS = [
  { key: 'yea', label: 'Yea', fill: 'fill-data-2', swatch: 'bg-data-2' },
  { key: 'nay', label: 'Nay', fill: 'fill-data-3', swatch: 'bg-data-3' },
  { key: 'present', label: 'Present', fill: 'fill-data-other', swatch: 'bg-data-other' },
  { key: 'notVoting', label: 'Not voting', fill: 'fill-sunk', swatch: 'bg-sunk' },
] as const;

/** How a roll call split, as a part-to-whole bar with every count printed beside it. */
export function TallyBar({ tally }: { tally: Tally }) {
  const total = Math.max(tally.yea + tally.nay + tally.present + tally.notVoting, 1);
  let x = 0;
  return (
    <div>
      <svg className="block h-2.5 w-full" aria-hidden="true">
        {PARTS.map((p) => {
          const width = (tally[p.key] / total) * 100;
          const rect = (
            <rect
              key={p.key}
              x={`${x}%`}
              width={`${width}%`}
              height="10"
              className={`${p.fill} stroke-surface`}
              strokeWidth="2"
            />
          );
          x += width;
          return rect;
        })}
      </svg>
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {PARTS.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-2 rounded-[1px] ${p.swatch}`} aria-hidden="true" />
            {p.label} <span className="num font-semibold text-ink">{tally[p.key]}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
