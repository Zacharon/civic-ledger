import type { CapabilityOutput } from '@civic-ledger/core';
import { partyTone } from './party';

export type Composition = CapabilityOutput<'chamber.composition'>;
export type ChamberBlock = Composition['chambers'][number];

/**
 * How a party square is drawn. Only Democrat and Republican take a (muted) party color,
 * the owner-approved exception for this chart (DESIGN.md, 2026-10-20). Independent and
 * every other party stay neutral; other parties are told apart by pattern, not hue.
 */
export type SeatTone =
  | 'democratic'
  | 'republican'
  | 'independent'
  | 'other-1'
  | 'other-2'
  | 'other-3'
  | 'vacant';

const OTHER_PATTERNS = ['other-1', 'other-2', 'other-3'] as const;

export interface SeatGroup {
  tone: SeatTone;
  /** Party name, or "Vacant". */
  label: string;
  count: number;
}

/** Grid width: 29 x 15 = 435 voting House seats; 10 x 10 = 100 Senate seats. */
export const SEAT_COLUMNS = { house: 29, senate: 10 } as const;

export function seatTone(party: string, otherIndex: number): SeatTone {
  const tone = partyTone(party);
  if (tone === 'democratic' || tone === 'republican') return tone;
  if (/^independent$/i.test(party.trim())) return 'independent';
  return OTHER_PATTERNS[otherIndex % OTHER_PATTERNS.length] ?? 'other-1';
}

/**
 * Groups in the capability's documented order (Democrat, Independent, Republican, then
 * other parties alphabetically), then vacancies last when they are known. This function
 * never re-sorts: the order rule lives in one place, core's `compareSeatParties`.
 */
export function seatGroups(block: ChamberBlock): SeatGroup[] {
  let others = 0;
  const groups: SeatGroup[] = block.voting.map((p) => {
    const tone = seatTone(p.party, others);
    if (tone.startsWith('other')) others++;
    return { tone, label: p.party, count: p.count };
  });
  if (block.vacancies !== null && block.vacancies > 0) {
    groups.push({ tone: 'vacant', label: 'Vacant', count: block.vacancies });
  }
  return groups;
}

/** Tones of the non-voting members, same styling rules, kept apart from the voting grid. */
export function nonVotingGroups(block: ChamberBlock): SeatGroup[] {
  let others = 0;
  return block.nonVoting.parties.map((p) => {
    const tone = seatTone(p.party, others);
    if (tone.startsWith('other')) others++;
    return { tone, label: p.party, count: p.count };
  });
}

/** One tone per square, in reading order. */
export function seatTones(groups: readonly SeatGroup[]): { tone: SeatTone; label: string }[] {
  return groups.flatMap((g) =>
    Array.from({ length: g.count }, () => ({ tone: g.tone, label: g.label })),
  );
}

/** One sentence naming every count, used as the chart's accessible name. */
export function compositionSentence(block: ChamberBlock, noun: string): string {
  const parts = block.voting.map((p) => `${p.count} ${p.party}`);
  const nonVoting =
    block.nonVoting.total > 0
      ? `; plus ${block.nonVoting.total} non-voting (${block.nonVoting.parties.map((p) => `${p.count} ${p.party}`).join(', ')})`
      : '';
  const vacancies =
    block.vacancies === null
      ? ''
      : `; ${block.vacancies} ${block.vacancies === 1 ? 'vacancy' : 'vacancies'}`;
  return `${noun}: ${block.members} of ${block.seats} voting seats filled (${parts.join(', ')})${vacancies}${nonVoting}.`;
}
