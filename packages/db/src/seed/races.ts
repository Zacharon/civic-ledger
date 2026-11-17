/**
 * Fictional 2026 races for the dev seed: candidates the way the FEC candidate master lists
 * them (name as filed, party code, ICI, status), a few matched to seeded people and most not.
 * Hand-written rather than generated, so the random stream behind the rest of the seed (and
 * every value derived from it) is unchanged. States ZV-ZW, invented names only.
 *
 * Money reports for matched incumbents are stored without a `person_id` (the real pipeline
 * does this for every FEC id it does not attribute), so profiles and Explore keep the 2024
 * cycle the rest of the seed uses.
 */

export const SEED_RACE_CYCLE = 2026;

export interface SeedCandidate {
  fecCandidateId: string;
  nameAsFiled: string;
  partyCode: string;
  office: 'H' | 'S';
  state: string;
  district: number | null;
  incumbency: 'I' | 'C' | 'O';
  status: 'C' | 'F' | 'N' | 'P';
  principalCommitteeId: string | null;
  /** Seeded person this FEC id maps to; null = a candidate with no person row. */
  slug: string | null;
}

export interface SeedRaceMoney {
  fecCandidateId: string;
  totalReceiptsCents: number;
  totalDisbursementsCents: number;
  /** As filed: can be negative. */
  cashOnHandCents: number;
  coverageEndDate: string;
}

export interface SeedRaceOutside {
  fecTransactionId: string;
  spenderIndex: number;
  fecCandidateId: string;
  supportOppose: 'support' | 'oppose';
  amountCents: number;
  expenditureDate: string;
}

const c = (
  fecCandidateId: string,
  nameAsFiled: string,
  partyCode: string,
  seat: { office: 'H' | 'S'; state: string; district: number | null },
  incumbency: SeedCandidate['incumbency'],
  status: SeedCandidate['status'],
  slug: string | null = null,
  principalCommitteeId: string | null = null,
): SeedCandidate => ({
  fecCandidateId,
  nameAsFiled,
  partyCode,
  ...seat,
  incumbency,
  status,
  principalCommitteeId,
  slug,
});

const ZV_SENATE = { office: 'S', state: 'ZV', district: null } as const;
const ZV_1 = { office: 'H', state: 'ZV', district: 1 } as const;
const ZZ_3 = { office: 'H', state: 'ZZ', district: 3 } as const;
const ZW_SENATE = { office: 'S', state: 'ZW', district: null } as const;
const ZW_3 = { office: 'H', state: 'ZW', district: 3 } as const;

export const SEED_CANDIDATES: readonly SeedCandidate[] = [
  // zv-senate: a sitting senator whose term ends January 3, 2027, and four registrants more.
  c('S4ZV00002', 'BRINDLEMOOR, BLAIR', 'PRA', ZV_SENATE, 'I', 'C', 'blair-brindlemoor'),
  c('S6ZV00001', 'TOWNSEND-FELL, ROWAN', 'HBR', ZV_SENATE, 'C', 'C', null, 'C99002001'),
  c('S6ZV00002', 'QUILLON, MARGUERITE ANNE DR.', 'IND', ZV_SENATE, 'C', 'C'),
  c('S6ZV00003', 'MCCRAE, DESMOND "DEZ"', 'LIB', ZV_SENATE, 'C', 'C'),
  c('S6ZV00004', "O'LEARY-VANCE, PRIYA MS.", 'HBR', ZV_SENATE, 'C', 'N'),
  // zv-1: incumbent, a former member running again (matched), two other challengers.
  c('H4ZV00003', 'CORROWIND, CAMERON', 'HBR', ZV_1, 'I', 'C', 'cameron-corrowind'),
  c('H6ZV01001', 'ASHGROVE, THEODORE JR.', 'PRA', ZV_1, 'C', 'C', null, 'C99002002'),
  c('H6ZV01002', 'FENWICK, ISOLDE', 'IND', ZV_1, 'C', 'C'),
  c('H6ZV01003', 'OAKHURST, CORNELIUS', 'PRA', ZV_1, 'C', 'C', 'cornelius-oakhurst'),
  // zz-3: an open seat: the sitting member is not running; every registrant is FEC "Open seat".
  c('H6ZZ03011', 'BRAMBLEWICK, JUNO', 'HBR', ZZ_3, 'O', 'C'),
  c('H6ZZ03012', 'STONEHALLOW, EZRA MR.', 'PRA', ZZ_3, 'O', 'C'),
  c('H6ZZ03013', 'LARKSPUR, WINIFRED', 'IND', ZZ_3, 'O', 'C'),
  // zw-senate: incumbent and one challenger.
  c('S4ZW00010', 'JUNIPERFIELD, JORDAN', 'PRA', ZW_SENATE, 'I', 'C', 'jordan-juniperfield'),
  c('S6ZW00001', 'DELACROIX-HUNT, SABINE', 'HBR', ZW_SENATE, 'C', 'C'),
  // zw-3: registrations only; nobody has a money report on file.
  c('H4ZW00013', 'MOSSGRAVE, MORGAN', 'HBR', ZW_3, 'I', 'C', 'morgan-mossgrave'),
  c('H6ZW03001', 'PENDLEBURY, ARCHIE', 'PRA', ZW_3, 'C', 'N'),
];

const money = (
  fecCandidateId: string,
  receipts: number,
  disbursements: number,
  cashOnHand: number,
): SeedRaceMoney => ({
  fecCandidateId,
  totalReceiptsCents: receipts * 100,
  totalDisbursementsCents: disbursements * 100,
  cashOnHandCents: cashOnHand * 100,
  coverageEndDate: '2026-09-30',
});

/** Candidates without an entry here have no money report on file. */
export const SEED_RACE_MONEY: readonly SeedRaceMoney[] = [
  money('S4ZV00002', 9_820_000, 6_700_000, 3_120_000),
  money('S6ZV00001', 4_210_000, 2_810_000, 1_400_000),
  // Spent more than raised: cash on hand is reported negative, as filed.
  money('S6ZV00002', 310_450, 322_450, -12_000),
  money('H4ZV00003', 1_930_000, 1_240_000, 690_000),
  money('H6ZV01001', 640_200, 590_100, 50_100),
  money('H6ZV01002', 52_300, 44_200, 8_100),
  money('H6ZZ03011', 221_900, 140_300, 81_600),
  money('H6ZZ03012', 185_000, 171_400, 13_600),
  money('S4ZW00010', 7_430_000, 5_015_000, 2_415_000),
  money('S6ZW00001', 2_880_000, 2_100_000, 780_000),
];

const ie = (
  n: number,
  spenderIndex: number,
  fecCandidateId: string,
  supportOppose: 'support' | 'oppose',
  dollars: number,
  expenditureDate: string,
): SeedRaceOutside => ({
  fecTransactionId: `DEVSEED-RACE-IE-${String(n).padStart(3, '0')}`,
  spenderIndex,
  fecCandidateId,
  supportOppose,
  amountCents: dollars * 100,
  expenditureDate,
});

export const SEED_RACE_OUTSIDE: readonly SeedRaceOutside[] = [
  ie(1, 0, 'S4ZV00002', 'support', 250_000, '2026-09-02'),
  ie(2, 1, 'S4ZV00002', 'oppose', 120_000, '2026-09-14'),
  ie(3, 2, 'S6ZV00001', 'support', 400_000, '2026-09-20'),
  ie(4, 0, 'S6ZV00001', 'oppose', 75_000, '2026-10-03'),
  ie(5, 1, 'H6ZV01001', 'oppose', 90_000, '2026-09-28'),
  ie(6, 2, 'S6ZW00001', 'support', 160_000, '2026-10-05'),
];
