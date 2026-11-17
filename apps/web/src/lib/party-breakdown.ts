import { summarizeTally, type Tally, type TallySummary } from './vote';

/** One party's row in "How each party voted": its own tally, meter and denominator. */
export interface PartyRow {
  party: string;
  summary: TallySummary;
}

export interface PartyBreakdownModel {
  rows: PartyRow[];
  /** The roll call's own tally, summarized the same way. */
  total: TallySummary;
  /** True when every category of every row adds up to the roll-call tally. */
  reconciles: boolean;
  /** Positions whose party could not be placed at the vote date (shown as their own row). */
  unplaced: number;
}

const UNKNOWN = 'Unknown';

/**
 * Builds the per-party model from the capability's `byParty` and the roll call's `tally`.
 * Rows keep the capability's order (alphabetical by party name, "Unknown" last). Party
 * rows are never merged and never re-sorted by size or ideology. `reconciles` is what the
 * UI states ("Rows add up to the roll-call total") and is verified, not assumed.
 */
export function partyBreakdown(
  byParty: readonly (Tally & { party: string })[],
  tally: Tally,
): PartyBreakdownModel {
  const rows = byParty.map((p) => ({ party: p.party, summary: summarizeTally(p) }));
  const total = summarizeTally(tally);
  const reconciles =
    rows.reduce((n, r) => n + r.summary.total, 0) === total.total &&
    total.parts.every(
      (part, i) => rows.reduce((n, r) => n + (r.summary.parts[i]?.count ?? 0), 0) === part.count,
    );
  return {
    rows,
    total,
    reconciles,
    unplaced: rows.find((r) => r.party === UNKNOWN)?.summary.total ?? 0,
  };
}

/** The party label shown for a row; "Unknown" becomes an explicit statement. */
export function partyRowLabel(party: string): string {
  return party === UNKNOWN ? 'Party not on file at the vote date' : party;
}
