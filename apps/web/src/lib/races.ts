import { ordinal } from './format';
import { STATE_NAMES } from './states';

/** The notice every race view carries: registration is not a ballot (DECISIONS A72). */
export const REGISTRATION_NOTICE =
  'FEC registration lists everyone who filed paperwork. It does not show who won a primary or who is on the November ballot.';

interface SeatParts {
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
}

export const stateName = (code: string) => STATE_NAMES[code] ?? code;

/** `Georgia Senate`, `Georgia 10th district`, `Alaska at-large district`. */
export function raceTitle(seat: SeatParts): string {
  const state = stateName(seat.state);
  if (seat.chamber === 'senate') return `${state} Senate`;
  return seat.district === 0 || seat.district === null
    ? `${state} at-large district`
    : `${state} ${ordinal(seat.district)} district`;
}

/** Stable race URL: `/races/2026/ga-senate`, `/races/2026/ga-10`, `/races/2026/ak-al`. */
export const raceHref = (cycle: number, seatKey: string) => `/races/${cycle}/${seatKey}`;

export function sortedStates(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort((a, b) => stateName(a).localeCompare(stateName(b)));
}
