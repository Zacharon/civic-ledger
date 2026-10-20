import { z } from 'zod';

/**
 * Seat keys are the stable race identifiers used in URLs, the API and MCP:
 * `ga-senate`, `ga-10`, and `ak-al` for an at-large House seat (DECISIONS A72).
 * A key names the seat in a state, not an election: a state with two Senate elections in
 * one cycle (a regular and a special) has one `-senate` key, because the FEC candidate
 * master does not say which of the two a Senate candidate is running in.
 */
export const SeatKeySchema = z
  .string()
  .regex(
    /^[a-z]{2}-(?:senate|al|[1-9][0-9]?)$/,
    'Expected a seat key such as ga-senate, ga-10 or ak-al (at-large)',
  );

export interface Seat {
  chamber: 'house' | 'senate';
  state: string;
  /** House district; 0 = at-large; null for the Senate. */
  district: number | null;
}

export function seatKey(seat: Seat): string {
  const state = seat.state.toLowerCase();
  if (seat.chamber === 'senate') return `${state}-senate`;
  return seat.district === 0 || seat.district === null
    ? `${state}-al`
    : `${state}-${seat.district}`;
}

export function parseSeatKey(key: string): Seat | null {
  const match = /^([a-z]{2})-(senate|al|[1-9][0-9]?)$/.exec(key);
  if (!match) return null;
  const state = (match[1] ?? '').toUpperCase();
  const part = match[2] ?? '';
  if (part === 'senate') return { chamber: 'senate', state, district: null };
  return { chamber: 'house', state, district: part === 'al' ? 0 : Number(part) };
}

/** Seats sort by state, then the Senate before the House, then district number. */
export function compareSeats(a: Seat, b: Seat): number {
  if (a.state !== b.state) return a.state < b.state ? -1 : 1;
  if (a.chamber !== b.chamber) return a.chamber === 'senate' ? -1 : 1;
  return (a.district ?? 0) - (b.district ?? 0);
}
