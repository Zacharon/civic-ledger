import type { Db, DbHandle } from '@civic-ledger/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_TYPES,
  dedupeIndependentExpenditures,
  dedupePas2,
  type Pas2Row,
} from '../src/adapters/fec-bulk/dedupe';
import {
  createIeStage,
  createPas2Stage,
  dedupeStagedIe,
  dedupeStagedPas2,
  type IeStageRow,
  keptIePages,
  keptPas2Pages,
  stageIe,
  stagePas2,
} from '../src/adapters/fec-bulk/stage';
import { freshDb } from './helpers';

/**
 * The bounded SQL dedupe (stage.ts) must keep exactly the rows the in-memory reference
 * rules (dedupe.ts, DECISIONS A12/A13) keep, with the same counters. Random inputs are
 * drawn from small value pools so groups, amendments, duplicates and ties are common.
 */
let handle: DbHandle;
beforeAll(async () => {
  handle = await freshDb();
});
afterAll(() => handle.close());

function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)] as T;

function pas2Rows(seed: number, n: number): Pas2Row[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    cmteId: pick(r, ['C1', 'C2', 'C3']),
    amndtInd: pick(r, ['N', 'A', 'T']),
    rptTp: pick(r, ['Q1', 'M4']),
    transactionTp: pick(r, ['24K', '24Z', '24E']),
    transactionDt: pick(r, ['01012026', '06012026', '01012025', '']),
    amount: pick(r, ['100', '-100', '250']),
    otherId: pick(r, ['', 'C9']),
    candId: pick(r, ['', 'H1', 'S2']),
    tranId: pick(r, ['', 'T1', 'T2', 'T3']),
    fileNum: pick(r, [1, 2, 3]),
    memoCd: pick(r, ['', '', '', 'X']),
    subId: String(1000 + Math.floor(r() * 50) + i * 100),
  }));
}

function ieRows(seed: number, n: number): IeStageRow[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    spenderId: pick(r, ['C1', 'C2']),
    spenderName: pick(r, ['', 'PAC ONE']),
    tranId: pick(r, ['E1', 'E2', 'E3']),
    fileNum: pick(r, [10, 11, 12, 13]),
    prevFileNum: pick(r, [null, null, 10, 11]),
    candidateId: pick(r, ['H1', 'S2', '']),
    supportOppose: pick(r, ['S', 'O', 'X']),
    amountCents: pick(r, [500, 900, 10_000_000_000]),
    date: pick(r, ['2026-01-01', null]),
    imageNum: pick(r, ['1', '2']),
    purpose: pick(r, [null, 'TV']),
  }));
}

async function inTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  return handle.db.transaction(work);
}

const pas2Key = (r: Pas2Row) => r.subId;
const ieKey = (r: IeStageRow) =>
  [r.spenderId, r.tranId, r.fileNum, r.candidateId, r.supportOppose, r.amountCents, r.date].join(
    '|',
  );

describe('SQL pas2 dedupe equals the reference rules', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}`, async () => {
      const rows = pas2Rows(seed, 400);
      const reference = dedupePas2(rows);
      const rowLocal = rows.filter(
        (r) => CONTRIBUTION_TYPES.has(r.transactionTp) && r.memoCd !== 'X',
      );
      const { stats, kept } = await inTransaction(async (tx) => {
        await createPas2Stage(tx);
        await stagePas2(tx, rowLocal);
        const stats = await dedupeStagedPas2(tx);
        const kept: Pas2Row[] = [];
        for await (const page of keptPas2Pages(tx)) kept.push(...page);
        return { stats, kept };
      });
      expect(stats).toEqual({
        amendmentSuperseded: reference.stats.amendmentSuperseded,
        duplicateReports: reference.stats.duplicateReports,
        kept: reference.stats.kept,
      });
      expect(kept.map(pas2Key).sort()).toEqual(reference.kept.map(pas2Key).sort());
    });
  }
});

describe('SQL IE dedupe equals the reference rules', () => {
  for (const seed of [11, 12, 13, 14, 15]) {
    it(`seed ${seed}`, async () => {
      const rows = ieRows(seed, 300);
      const reference = dedupeIndependentExpenditures(rows);
      const { stats, kept } = await inTransaction(async (tx) => {
        await createIeStage(tx);
        await stageIe(tx, rows);
        const stats = await dedupeStagedIe(tx);
        const kept: IeStageRow[] = [];
        for await (const page of keptIePages(tx)) kept.push(...page);
        return { stats, kept };
      });
      const { rows: _rows, ...expected } = reference.stats;
      expect(stats).toEqual(expected);
      expect(kept.map(ieKey).sort()).toEqual(reference.kept.map(ieKey).sort());
    });
  }
});
