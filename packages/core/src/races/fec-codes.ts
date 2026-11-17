/**
 * FEC code vocabularies for the candidate master (CAND_ICI, CAND_STATUS, CAND_PTY_AFFILIATION).
 * Labels restate the FEC's own definitions; unknown codes are shown as filed, never guessed.
 */

export const INCUMBENCY_LABELS: Record<string, string> = {
  I: 'Incumbent',
  C: 'Challenger',
  O: 'Open seat',
};

export const STATUS_LABELS: Record<string, string> = {
  C: 'Statutory candidate',
  F: 'Statutory candidate for future election',
  N: 'Not yet a statutory candidate',
  P: 'Statutory candidate in prior cycle',
};

/** The party codes the FEC uses most; every other code falls back to the code itself. */
const PARTY_NAMES: Record<string, string> = {
  DEM: 'Democratic Party',
  REP: 'Republican Party',
  DFL: 'Democratic-Farmer-Labor',
  LIB: 'Libertarian Party',
  GRE: 'Green Party',
  CON: 'Constitution Party',
  IND: 'Independent',
  NPA: 'No party affiliation',
  NNE: 'None',
  NON: 'None',
  UN: 'Unaffiliated',
  UNK: 'Unknown',
  OTH: 'Other',
};

export function partyName(code: string | null): string | null {
  if (!code) return null;
  return PARTY_NAMES[code.trim().toUpperCase()] ?? null;
}

export const fecCandidateUrl = (fecCandidateId: string) =>
  `https://www.fec.gov/data/candidate/${encodeURIComponent(fecCandidateId)}/`;
