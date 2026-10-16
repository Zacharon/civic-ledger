export interface ScatterPoint {
  key: string;
  x: number;
  y: number | null;
}

const W = 560;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 40, left: 16 };

const sx = (x: number) => PAD.left + ((x + 1) / 2) * (W - PAD.left - PAD.right);
const sy = (y: number) => PAD.top + ((1 - y) / 2) * (H - PAD.top - PAD.bottom);

/**
 * DW-NOMINATE dim1 × dim2 for every member of a chamber. Everyone is the same neutral
 * ink; the profiled member gets a ring and a label. Position carries the meaning, never color.
 */
export function MemberScatter({
  points,
  focus,
  label,
}: {
  points: ScatterPoint[];
  focus: ScatterPoint & { name: string };
  label: string;
}) {
  const fy = focus.y ?? 0;
  const labelRight = sx(focus.x) < W * 0.7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
      <rect
        x={PAD.left}
        y={PAD.top}
        width={W - PAD.left - PAD.right}
        height={H - PAD.top - PAD.bottom}
        className="fill-none stroke-rule"
      />
      <line x1={sx(0)} x2={sx(0)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-rule" />
      <line x1={PAD.left} x2={W - PAD.right} y1={sy(0)} y2={sy(0)} className="stroke-rule" />
      {points.map((p) =>
        p.key === focus.key ? null : (
          <circle
            key={p.key}
            cx={sx(p.x)}
            cy={sy(p.y ?? 0)}
            r="4"
            className="fill-ink-3 stroke-surface"
            fillOpacity="0.55"
            strokeWidth="1"
          />
        ),
      )}
      <circle cx={sx(focus.x)} cy={sy(fy)} r="9" className="fill-none stroke-ink" strokeWidth="2" />
      <circle
        cx={sx(focus.x)}
        cy={sy(fy)}
        r="4.5"
        className="fill-ink stroke-surface"
        strokeWidth="2"
      />
      <text
        x={sx(focus.x) + (labelRight ? 14 : -14)}
        y={sy(fy) + 4}
        textAnchor={labelRight ? 'start' : 'end'}
        className="fill-ink text-[13px] font-semibold"
      >
        {focus.name}
      </text>
      <text x={PAD.left} y={H - 14} className="fill-ink-2 text-[12px]">
        ← More liberal
      </text>
      <text x={W - PAD.right} y={H - 14} textAnchor="end" className="fill-ink-2 text-[12px]">
        More conservative →
      </text>
      <text x={sx(0)} y={H - 14} textAnchor="middle" className="num fill-ink-3 text-[12px]">
        0
      </text>
    </svg>
  );
}
