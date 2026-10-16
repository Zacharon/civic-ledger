import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { RawSnapshot } from '../../adapter';
import { fecPipeRows, headerCsvRows, named } from '../../parse/csv';
import {
  dateFromDdMonYy,
  dateFromMmddyyyy,
  dateFromSlashed,
  dollarsToCents,
  parseIntOrNull,
  trimOrNull,
} from '../../parse/values';
import { zipEntry } from '../../parse/zip';
import {
  dedupeIndependentExpenditures,
  dedupePas2,
  type IeDedupeStats,
  type IeRow,
  ieTransactionKey,
  type Pas2DedupeStats,
  type Pas2Row,
} from './dedupe';

/** FEC bulk file names for a two-year cycle (2026 → cn26.zip, ...). */
export function fecFiles(cycle: number) {
  const yy = String(cycle % 100).padStart(2, '0');
  return {
    cn: { zip: `cn${yy}.zip`, entry: 'cn.txt' },
    cm: { zip: `cm${yy}.zip`, entry: 'cm.txt' },
    ccl: { zip: `ccl${yy}.zip`, entry: 'ccl.txt' },
    weball: { zip: `weball${yy}.zip`, entry: `weball${yy}.txt` },
    pas2: { zip: `pas2${yy}.zip`, entry: 'itpas2.txt' },
    ie: `independent_expenditure_${cycle}.csv`,
    summary: `candidate_summary_${cycle}.csv`,
  } as const;
}

// Column layouts from the FEC data dictionaries (files have no header row).
const CN = [
  'CAND_ID',
  'CAND_NAME',
  'CAND_PTY_AFFILIATION',
  'CAND_ELECTION_YR',
  'CAND_OFFICE_ST',
  'CAND_OFFICE',
  'CAND_OFFICE_DISTRICT',
  'CAND_ICI',
  'CAND_STATUS',
  'CAND_PCC',
  'CAND_ST1',
  'CAND_ST2',
  'CAND_CITY',
  'CAND_ST',
  'CAND_ZIP',
] as const;
const CM = [
  'CMTE_ID',
  'CMTE_NM',
  'TRES_NM',
  'CMTE_ST1',
  'CMTE_ST2',
  'CMTE_CITY',
  'CMTE_ST',
  'CMTE_ZIP',
  'CMTE_DSGN',
  'CMTE_TP',
  'CMTE_PTY_AFFILIATION',
  'CMTE_FILING_FREQ',
  'ORG_TP',
  'CONNECTED_ORG_NM',
  'CAND_ID',
] as const;
const CCL = [
  'CAND_ID',
  'CAND_ELECTION_YR',
  'FEC_ELECTION_YR',
  'CMTE_ID',
  'CMTE_TP',
  'CMTE_DSGN',
  'LINKAGE_ID',
] as const;
const WEBALL = [
  'CAND_ID',
  'CAND_NAME',
  'CAND_ICI',
  'PTY_CD',
  'CAND_PTY_AFFILIATION',
  'TTL_RECEIPTS',
  'TRANS_FROM_AUTH',
  'TTL_DISB',
  'TRANS_TO_AUTH',
  'COH_BOP',
  'COH_COP',
  'CAND_CONTRIB',
  'CAND_LOANS',
  'OTHER_LOANS',
  'CAND_LOAN_REPAY',
  'OTHER_LOAN_REPAY',
  'DEBTS_OWED_BY',
  'TTL_INDIV_CONTRIB',
  'CAND_OFFICE_ST',
  'CAND_OFFICE_DISTRICT',
  'SPEC_ELECTION',
  'PRIM_ELECTION',
  'RUN_ELECTION',
  'GEN_ELECTION',
  'GEN_ELECTION_PRECENT',
  'OTHER_POL_CMTE_CONTRIB',
  'POL_PTY_CONTRIB',
  'CVG_END_DT',
  'INDIV_REFUNDS',
  'CMTE_REFUNDS',
] as const;
const PAS2 = [
  'CMTE_ID',
  'AMNDT_IND',
  'RPT_TP',
  'TRANSACTION_PGI',
  'IMAGE_NUM',
  'TRANSACTION_TP',
  'ENTITY_TP',
  'NAME',
  'CITY',
  'STATE',
  'ZIP_CODE',
  'EMPLOYER',
  'OCCUPATION',
  'TRANSACTION_DT',
  'TRANSACTION_AMT',
  'OTHER_ID',
  'CAND_ID',
  'TRAN_ID',
  'FILE_NUM',
  'MEMO_CD',
  'MEMO_TEXT',
  'SUB_ID',
] as const;
/** Candidate summary: lower-cased header names (headerCsvRows). Address columns are never read. */
const SUMMARY = [
  'cand_id',
  'total_receipt',
  'individual_contribution',
  'individual_itemized_contribution',
  'individual_unitemized_contribution',
  'coverage_end_date',
] as const;
const IE = [
  'cand_id',
  'spe_id',
  'spe_nam',
  'sup_opp',
  'exp_amo',
  'exp_date',
  'dissem_dt',
  'pur',
  'file_num',
  'prev_file_num',
  'tran_id',
  'image_num',
  'amndt_ind',
] as const;

export interface CommitteeRecord {
  kind: 'committee';
  id: string;
  name: string;
  designation: string | null;
  type: string | null;
  party: string | null;
  orgType: string | null;
  connectedOrg: string | null;
  candidateId: string | null;
}

export interface CandidateRecord {
  kind: 'candidate';
  id: string;
  party: string | null;
  electionYear: number | null;
  office: 'H' | 'S' | 'P' | null;
  state: string | null;
  district: number | null;
}

export interface LinkRecord {
  kind: 'link';
  candidateId: string;
  committeeId: string;
  fecElectionYear: number;
  designation: string | null;
}

export interface TotalsRecord {
  kind: 'totals';
  candidateId: string;
  totalReceiptsCents: number;
  individualCents: number;
  otherCommitteeCents: number;
  partyCents: number;
  /** Candidate contributions plus candidate loans: the candidate's own money. */
  candidateSelfCents: number;
  totalDisbursementsCents: number;
  cashOnHandCents: number;
  debtsCents: number;
  coverageEndDate: string | null;
}

/** Itemized / unitemized split of individual gifts (candidate summary file). */
export interface SummaryRecord {
  kind: 'summary';
  candidateId: string;
  totalReceiptsCents: number;
  individualCents: number;
  itemizedIndividualCents: number;
  unitemizedIndividualCents: number;
  coverageEndDate: string | null;
}

export interface ContributionRecord {
  kind: 'contribution';
  subId: string;
  committeeId: string;
  candidateId: string | null;
  otherId: string | null;
  amountCents: number;
  date: string | null;
  transactionType: string;
}

export interface IeRecord {
  kind: 'ie';
  spenderId: string;
  spenderName: string;
  transactionKey: string;
  candidateId: string | null;
  supportOppose: 'support' | 'oppose';
  amountCents: number;
  date: string | null;
  purpose: string | null;
}

export interface StatsRecord {
  kind: 'stats';
  pas2?: Pas2DedupeStats;
  ie?: IeDedupeStats & { normalizedCandidateIds: number };
}

export type FecRecord =
  | CommitteeRecord
  | CandidateRecord
  | LinkRecord
  | TotalsRecord
  | SummaryRecord
  | ContributionRecord
  | IeRecord
  | StatsRecord;

/** FEC ids are upper-case; the IE file has some lower-case ones (e.g. "h2az02360"). */
const fecId = (value: string | undefined): string => (value ?? '').trim().toUpperCase();

const office = (v: string): CandidateRecord['office'] =>
  v === 'H' || v === 'S' || v === 'P' ? v : null;
const cents = (v: string) => dollarsToCents(v) ?? 0;

/**
 * Committees, candidates, links and totals stream straight through. pas2 and the IE file
 * are collected as compact rows first because their dedupe rules compare rows across the
 * whole file (amendments refer to earlier filings).
 */
export async function* parseFec(snapshot: RawSnapshot, cycle: number): AsyncGenerator<FecRecord> {
  const files = fecFiles(cycle);
  const path = (name: string) => join(snapshot.directory, name);

  for await (const stream of zipEntry(path(files.cm.zip), files.cm.entry)) {
    for await (const raw of fecPipeRows(stream, CM.length)) {
      const r = named(CM, raw);
      yield {
        kind: 'committee',
        id: r.CMTE_ID,
        name: r.CMTE_NM.trim() || r.CMTE_ID,
        designation: trimOrNull(r.CMTE_DSGN),
        type: trimOrNull(r.CMTE_TP),
        party: trimOrNull(r.CMTE_PTY_AFFILIATION),
        orgType: trimOrNull(r.ORG_TP),
        connectedOrg: trimOrNull(r.CONNECTED_ORG_NM),
        candidateId: trimOrNull(r.CAND_ID),
      };
    }
  }
  for await (const stream of zipEntry(path(files.cn.zip), files.cn.entry)) {
    for await (const raw of fecPipeRows(stream, CN.length)) {
      const r = named(CN, raw);
      yield {
        kind: 'candidate',
        id: r.CAND_ID,
        party: trimOrNull(r.CAND_PTY_AFFILIATION),
        electionYear: parseIntOrNull(r.CAND_ELECTION_YR),
        office: office(r.CAND_OFFICE),
        state: trimOrNull(r.CAND_OFFICE_ST),
        // FEC: "00" = at-large House seat (and every Senate/presidential row).
        district: parseIntOrNull(r.CAND_OFFICE_DISTRICT),
      };
    }
  }
  for await (const stream of zipEntry(path(files.ccl.zip), files.ccl.entry)) {
    for await (const raw of fecPipeRows(stream, CCL.length)) {
      const r = named(CCL, raw);
      const year = parseIntOrNull(r.FEC_ELECTION_YR);
      if (year === null) continue;
      yield {
        kind: 'link',
        candidateId: r.CAND_ID,
        committeeId: r.CMTE_ID,
        fecElectionYear: year,
        designation: trimOrNull(r.CMTE_DSGN),
      };
    }
  }
  for await (const stream of zipEntry(path(files.weball.zip), files.weball.entry)) {
    for await (const raw of fecPipeRows(stream, WEBALL.length)) {
      const r = named(WEBALL, raw);
      yield {
        kind: 'totals',
        candidateId: r.CAND_ID,
        totalReceiptsCents: cents(r.TTL_RECEIPTS),
        individualCents: cents(r.TTL_INDIV_CONTRIB),
        otherCommitteeCents: cents(r.OTHER_POL_CMTE_CONTRIB),
        partyCents: cents(r.POL_PTY_CONTRIB),
        candidateSelfCents: cents(r.CAND_CONTRIB) + cents(r.CAND_LOANS),
        totalDisbursementsCents: cents(r.TTL_DISB),
        cashOnHandCents: cents(r.COH_COP),
        debtsCents: cents(r.DEBTS_OWED_BY),
        coverageEndDate: dateFromSlashed(r.CVG_END_DT),
      };
    }
  }

  for await (const row of headerCsvRows(createReadStream(path(files.summary)), SUMMARY, 'latin1')) {
    const candidateId = fecId(row.cand_id);
    if (!candidateId) continue;
    yield {
      kind: 'summary',
      candidateId,
      totalReceiptsCents: cents(row.total_receipt ?? ''),
      individualCents: cents(row.individual_contribution ?? ''),
      itemizedIndividualCents: cents(row.individual_itemized_contribution ?? ''),
      unitemizedIndividualCents: cents(row.individual_unitemized_contribution ?? ''),
      coverageEndDate: dateFromSlashed(row.coverage_end_date ?? ''),
    };
  }

  const pas2: Pas2Row[] = [];
  for await (const stream of zipEntry(path(files.pas2.zip), files.pas2.entry)) {
    for await (const raw of fecPipeRows(stream, PAS2.length)) {
      // NAME/CITY/EMPLOYER/OCCUPATION are never read: no contributor identity is kept.
      const r = named(PAS2, raw);
      pas2.push({
        cmteId: r.CMTE_ID,
        amndtInd: r.AMNDT_IND,
        rptTp: r.RPT_TP,
        transactionTp: r.TRANSACTION_TP,
        transactionDt: r.TRANSACTION_DT.trim(),
        amount: r.TRANSACTION_AMT.trim(),
        otherId: fecId(r.OTHER_ID),
        candId: fecId(r.CAND_ID),
        tranId: r.TRAN_ID.trim(),
        fileNum: parseIntOrNull(r.FILE_NUM) ?? 0,
        memoCd: r.MEMO_CD.trim(),
        subId: r.SUB_ID.trim(),
      });
    }
  }
  const contributions = dedupePas2(pas2);
  pas2.length = 0;
  for (const row of contributions.kept) {
    yield {
      kind: 'contribution',
      subId: row.subId,
      committeeId: row.cmteId,
      candidateId: row.candId || null,
      otherId: row.otherId || null,
      amountCents: cents(row.amount),
      date: dateFromMmddyyyy(row.transactionDt),
      transactionType: row.transactionTp,
    };
  }
  yield { kind: 'stats', pas2: contributions.stats };

  type IeParsed = IeRow & { spenderName: string; purpose: string | null };
  const ies: IeParsed[] = [];
  let normalizedCandidateIds = 0;
  for await (const row of headerCsvRows(createReadStream(path(files.ie)), IE)) {
    if (row.cand_id && row.cand_id.trim() !== fecId(row.cand_id)) normalizedCandidateIds++;
    ies.push({
      spenderId: fecId(row.spe_id),
      spenderName: (row.spe_nam ?? '').trim(),
      tranId: (row.tran_id ?? '').trim(),
      fileNum: parseIntOrNull(row.file_num) ?? 0,
      prevFileNum: parseIntOrNull(row.prev_file_num),
      candidateId: fecId(row.cand_id),
      supportOppose: (row.sup_opp ?? '').trim(),
      amountCents: cents(row.exp_amo ?? ''),
      date: dateFromDdMonYy(row.exp_date) ?? dateFromDdMonYy(row.dissem_dt),
      imageNum: (row.image_num ?? '').trim(),
      purpose: trimOrNull(row.pur),
    });
  }
  const expenditures = dedupeIndependentExpenditures(ies);
  for (const row of expenditures.kept) {
    yield {
      kind: 'ie',
      spenderId: row.spenderId,
      spenderName: row.spenderName || row.spenderId,
      transactionKey: ieTransactionKey(row),
      candidateId: row.candidateId || null,
      supportOppose: row.supportOppose === 'S' ? 'support' : 'oppose',
      amountCents: row.amountCents,
      date: row.date,
      purpose: row.purpose,
    };
  }
  yield { kind: 'stats', ie: { ...expenditures.stats, normalizedCandidateIds } };
}
