import { type Seat, seatKey } from './seat';

/**
 * States and territories with one House seat (apportionment, 2020 census). The FEC files
 * their candidates with district "00", "01" or nothing; congress-legislators uses 0. In
 * these places every House registration belongs to the at-large seat (DECISIONS A79).
 */
export const SINGLE_SEAT_STATES: ReadonlySet<string> = new Set([
  'AK',
  'DE',
  'ND',
  'SD',
  'VT',
  'WY',
  'DC',
  'AS',
  'GU',
  'MP',
  'PR',
  'VI',
]);

export interface FiledRow {
  /** FEC CAND_OFFICE: 'H' or 'S'. */
  office: string;
  state: string;
  /** District as filed: null = blank. */
  district: number | null;
}

export type Placement =
  | { seat: Seat; seatKey: string }
  | { seat: null; chamber: 'house' | 'senate'; state: string; districtAsFiled: number | null };

/**
 * Decides which seat a filed row belongs to. A row belongs to a seat only when that seat
 * exists (`existing` holds the keys of seats with a current or apportioned office); a
 * blank district in a state with several districts, "00" there, or a district past the
 * state's last one is "as filed" with no seat, never an invented one.
 */
export function placeRow(row: FiledRow, existing: ReadonlySet<string>): Placement {
  const chamber = row.office === 'S' ? 'senate' : 'house';
  let seat: Seat;
  if (chamber === 'senate') {
    seat = { chamber, state: row.state, district: null };
  } else if (SINGLE_SEAT_STATES.has(row.state)) {
    seat = { chamber, state: row.state, district: 0 };
  } else if (row.district === null || row.district === 0) {
    // Blank or "00" in a state with several districts: no seat can be named.
    return { seat: null, chamber, state: row.state, districtAsFiled: row.district };
  } else {
    seat = { chamber, state: row.state, district: row.district };
  }
  const key = seatKey(seat);
  if (!existing.has(key)) {
    return {
      seat: null,
      chamber,
      state: row.state,
      districtAsFiled: chamber === 'senate' ? null : row.district,
    };
  }
  return { seat, seatKey: key };
}
