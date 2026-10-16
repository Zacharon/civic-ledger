/**
 * FEC transaction dedupe rules, adopted from the 2026-cycle files on 2026-10-16 (see
 * docs/DECISIONS.md A12/A13 and the tests in test/fec-dedupe.test.ts).
 *
 * Findings that shaped them:
 * - pas2 `TRAN_ID` is not unique per committee: filers reuse ids on every report
 *   (`SB23.1` monthly) and a refund reuses the original's id on a later report. "Latest
 *   row per (CMTE_ID, TRAN_ID)" would delete real contributions and keep only refunds.
 * - FEC already removes most rows of superseded reports; amended originals survive only
 *   rarely (same report type and year, earlier FILE_NUM, later row marked A/T).
 * - The IE file keeps superseded filings (their FILE_NUM is another row's
 *   `prev_file_num`), and both committees and Form 5 filers reuse `tran_id` per filing.
 */

export interface Pas2Row {
  cmteId: string;
  amndtInd: string;
  rptTp: string;
  transactionTp: string;
  /** Raw MMDDYYYY (may be blank). */
  transactionDt: string;
  /** Raw whole-dollar amount string; negative = refund. */
  amount: string;
  otherId: string;
  candId: string;
  tranId: string;
  fileNum: number;
  memoCd: string;
  subId: string;
}

/** Direct (24K) and in-kind (24Z) contributions. IEs (24E/24A) come from the IE file. */
export const CONTRIBUTION_TYPES = new Set(['24K', '24Z']);

export interface Pas2DedupeStats {
  rows: number;
  excludedType: number;
  memoDropped: number;
  amendmentSuperseded: number;
  duplicateReports: number;
  kept: number;
}

const latest = <T extends { fileNum: number; subId: string }>(a: T, b: T): T =>
  b.fileNum > a.fileNum || (b.fileNum === a.fileNum && BigInt(b.subId) > BigInt(a.subId)) ? b : a;

/**
 * 1. keep 24K/24Z only; 2. drop memo rows (`MEMO_CD = X`: itemized elsewhere, not counted);
 * 3. amendment supersession: within (committee, report type, TRAN_ID, transaction year),
 *    when the latest filing's rows are marked A (amendment) or T (termination), rows from
 *    earlier filings are dropped; 4. an identical transaction (committee, TRAN_ID, type,
 *    date, amount, recipient) reported on several reports counts once (latest filing).
 *    Refunds (negative amounts) are kept so they net against the original contribution.
 */
export function dedupePas2(rows: readonly Pas2Row[]): { kept: Pas2Row[]; stats: Pas2DedupeStats } {
  const stats: Pas2DedupeStats = {
    rows: rows.length,
    excludedType: 0,
    memoDropped: 0,
    amendmentSuperseded: 0,
    duplicateReports: 0,
    kept: 0,
  };
  const groups = new Map<string, Pas2Row[]>();
  for (const row of rows) {
    if (!CONTRIBUTION_TYPES.has(row.transactionTp)) {
      stats.excludedType++;
      continue;
    }
    if (row.memoCd === 'X') {
      stats.memoDropped++;
      continue;
    }
    const key = row.tranId
      ? `${row.cmteId}|${row.rptTp}|${row.tranId}|${row.transactionDt.slice(4)}`
      : `sub:${row.subId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const afterAmendments: Pas2Row[] = [];
  for (const group of groups.values()) {
    const newestFile = Math.max(...group.map((r) => r.fileNum));
    const newest = group.filter((r) => r.fileNum === newestFile);
    const amended =
      group.length > newest.length && newest.some((r) => r.amndtInd === 'A' || r.amndtInd === 'T');
    if (amended) {
      stats.amendmentSuperseded += group.length - newest.length;
      afterAmendments.push(...newest);
    } else {
      afterAmendments.push(...group);
    }
  }

  const unique = new Map<string, Pas2Row>();
  for (const row of afterAmendments) {
    const key = row.tranId
      ? [
          row.cmteId,
          row.tranId,
          row.transactionTp,
          row.transactionDt,
          row.amount,
          row.candId || row.otherId,
        ].join('|')
      : `sub:${row.subId}`;
    const seen = unique.get(key);
    if (seen) stats.duplicateReports++;
    unique.set(key, seen ? latest(seen, row) : row);
  }
  const kept = [...unique.values()];
  stats.kept = kept.length;
  return { kept, stats };
}

export interface IeRow {
  spenderId: string;
  tranId: string;
  fileNum: number;
  prevFileNum: number | null;
  candidateId: string;
  supportOppose: string;
  /** Exact cents. */
  amountCents: number;
  /** ISO date: expenditure date, else dissemination date. */
  date: string | null;
  imageNum: string;
}

/** No real single independent expenditure approaches this; larger rows are filing errors. */
export const IE_IMPLAUSIBLE_CENTS = 100_000_000 * 100;

export interface IeDedupeStats {
  rows: number;
  invalidSupportOppose: number;
  superseded: number;
  duplicateReports: number;
  implausibleAmount: number;
  kept: number;
}

/**
 * 1. drop rows whose support/oppose flag is not S/O; 2. drop superseded filings (their
 * FILE_NUM is some row's `prev_file_num`); 3. an identical expenditure (spender, tran_id,
 * candidate, S/O, amount, date) re-reported on later 24/48-hour filings counts once (latest
 * filing); 4. drop single expenditures of $100M or more (bogus filings; reported).
 * The natural key of a kept row is `${fileNum}:${tranId}` (tran ids repeat across filings).
 */
export function dedupeIndependentExpenditures<T extends IeRow>(
  rows: readonly T[],
): { kept: T[]; stats: IeDedupeStats } {
  const stats: IeDedupeStats = {
    rows: rows.length,
    invalidSupportOppose: 0,
    superseded: 0,
    duplicateReports: 0,
    implausibleAmount: 0,
    kept: 0,
  };
  const supersededFiles = new Set<number>();
  for (const row of rows) if (row.prevFileNum !== null) supersededFiles.add(row.prevFileNum);

  const unique = new Map<string, T>();
  for (const row of rows) {
    if (row.supportOppose !== 'S' && row.supportOppose !== 'O') {
      stats.invalidSupportOppose++;
      continue;
    }
    if (supersededFiles.has(row.fileNum)) {
      stats.superseded++;
      continue;
    }
    if (Math.abs(row.amountCents) >= IE_IMPLAUSIBLE_CENTS) {
      stats.implausibleAmount++;
      continue;
    }
    const key = [
      row.spenderId,
      row.tranId,
      row.candidateId,
      row.supportOppose,
      row.amountCents,
      row.date ?? '',
    ].join('|');
    const seen = unique.get(key);
    if (seen) stats.duplicateReports++;
    unique.set(key, !seen || row.fileNum > seen.fileNum ? row : seen);
  }
  const kept = [...unique.values()];
  stats.kept = kept.length;
  return { kept, stats };
}

export const ieTransactionKey = (row: Pick<IeRow, 'fileNum' | 'tranId'>) =>
  `${row.fileNum}:${row.tranId}`;
