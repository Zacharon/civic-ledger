/**
 * Roll-call vote presentation, shared by every vote meter, legend and table cell.
 *
 * Vote color is its own semantic family (`--vote-*`, DESIGN.md): teal for Yea, amber for
 * Nay, grey for Not voting, hatched grey for Present. It is never derived from party and
 * never uses the red or blue reserved for party chips. Each category keeps its own label;
 * Present and Not voting are distinct official positions and are never merged.
 */
export type VotePosition = 'yea' | 'nay' | 'present' | 'not_voting';

export interface Tally {
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
}

/** Display order, label and CSS key class (see `.vote-*` in globals.css). */
export const VOTE_PARTS = [
  { key: 'yea', position: 'yea', label: 'Yea', className: 'vote-yea' },
  { key: 'nay', position: 'nay', label: 'Nay', className: 'vote-nay' },
  { key: 'present', position: 'present', label: 'Present', className: 'vote-present' },
  { key: 'notVoting', position: 'not_voting', label: 'Not voting', className: 'vote-not-voting' },
] as const satisfies readonly {
  key: keyof Tally;
  position: VotePosition;
  label: string;
  className: string;
}[];

export const VOTE_KEY_CLASS: Record<VotePosition, string> = {
  yea: 'vote-yea',
  nay: 'vote-nay',
  present: 'vote-present',
  not_voting: 'vote-not-voting',
};

export interface TallySegment {
  key: keyof Tally;
  label: string;
  className: string;
  count: number;
  /** Share of `total` in [0, 1]; 0 when the total is 0. */
  share: number;
}

export interface TallySummary {
  /** Recorded positions: yea + nay + present + not voting. The meter's denominator. */
  total: number;
  /** Every category, in display order, including zero counts (the legend). */
  parts: TallySegment[];
  /** Categories with a non-zero count (the meter); empty when nothing was recorded. */
  segments: TallySegment[];
}

/**
 * The legend and the meter come from this one function so they cannot disagree. Counts
 * are never inflated to make a tiny category visible; its number is always printed.
 */
export function summarizeTally(tally: Tally): TallySummary {
  const total = VOTE_PARTS.reduce((sum, p) => sum + safeCount(tally[p.key]), 0);
  const parts = VOTE_PARTS.map((p) => {
    const count = safeCount(tally[p.key]);
    return {
      key: p.key,
      label: p.label,
      className: p.className,
      count,
      share: total > 0 ? count / total : 0,
    };
  });
  return { total, parts, segments: parts.filter((p) => p.count > 0) };
}

function safeCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
