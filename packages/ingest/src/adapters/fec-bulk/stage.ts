import type { Db } from '@civic-ledger/db';
import { type SQL, sql } from 'drizzle-orm';
import { BATCH_SIZE } from '../../runtime/batch';
import { IE_IMPLAUSIBLE_CENTS, type IeRow, type Pas2Row } from './dedupe';

/**
 * Bounded FEC dedupe (H3-05, DECISIONS A53). pas2 amendment supersession and the IE
 * superseded-filing rule compare rows across a whole file, so the parser used to collect
 * every row in memory first. Rows now stream into session temp tables in batches and the
 * rules of `dedupe.ts` (still the reference, and tested for equality with this) run in
 * SQL; kept rows are read back one page at a time. Memory is O(batch), not O(file).
 * The tables live in the run's load transaction: a rollback removes them, and they are
 * dropped after use. `check` is the run's cancellation checkpoint: the stage creators
 * call it between their DROP and CREATE (H3R3), the dedupe before each of its statements
 * and the page readers before every page (H3R2-02). The caller checks before the first
 * statement of each helper.
 */
const PAS2_STAGE = 'fec_pas2_stage';
const PAS2_KEPT = 'fec_pas2_kept';
const IE_STAGE = 'fec_ie_stage';
const IE_KEPT = 'fec_ie_kept';

export type IeStageRow = IeRow & { spenderName: string; purpose: string | null };

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;

/** A cancellation checkpoint: throws when the run must stop. */
export type Check = () => void;
const noCheck: Check = () => {};

export async function createPas2Stage(db: Db, check: Check = noCheck): Promise<void> {
  await db.execute(sql.raw(`drop table if exists ${PAS2_STAGE}, ${PAS2_KEPT}`));
  check();
  await db.execute(
    sql.raw(`create temp table ${PAS2_STAGE} (
      seq bigint generated always as identity primary key,
      cmte_id text not null, amndt_ind text not null, rpt_tp text not null,
      transaction_tp text not null, transaction_dt text not null, amount text not null,
      other_id text not null, cand_id text not null, tran_id text not null,
      file_num bigint not null, memo_cd text not null, sub_id text not null)`),
  );
}

export async function stagePas2(db: Db, rows: readonly Pas2Row[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(
    (r) =>
      sql`(${r.cmteId}, ${r.amndtInd}, ${r.rptTp}, ${r.transactionTp}, ${r.transactionDt}, ${r.amount}, ${r.otherId}, ${r.candId}, ${r.tranId}, ${r.fileNum}, ${r.memoCd}, ${r.subId})`,
  );
  await db.execute(
    sql`insert into ${sql.identifier(PAS2_STAGE)} (cmte_id, amndt_ind, rpt_tp, transaction_tp, transaction_dt, amount, other_id, cand_id, tran_id, file_num, memo_cd, sub_id) values ${sql.join(values, sql`, `)}`,
  );
}

export interface Pas2SqlStats {
  amendmentSuperseded: number;
  duplicateReports: number;
  kept: number;
}

/**
 * Rules 3 and 4 of `dedupePas2` (rules 1 and 2 are row-local and applied while parsing).
 * Supersession group: (committee, report type, TRAN_ID, transaction year); duplicate key:
 * (committee, TRAN_ID, type, date, amount, recipient); latest = highest FILE_NUM, then SUB_ID.
 */
export async function dedupeStagedPas2(db: Db, check: Check = noCheck): Promise<Pas2SqlStats> {
  check();
  await db.execute(
    sql.raw(`create temp table ${PAS2_KEPT} as
    with g as (
      select s.*, case when tran_id <> ''
        then cmte_id || '|' || rpt_tp || '|' || tran_id || '|' || substr(transaction_dt, 5)
        else 'sub:' || sub_id end as gkey
      from ${PAS2_STAGE} s
    ),
    newest as (select gkey, max(file_num) as file_num, count(*) as n from g group by gkey),
    groups as (
      select g.gkey, n.file_num as newest, n.n,
        count(*) filter (where g.file_num = n.file_num) as n_newest,
        bool_or(g.file_num = n.file_num and g.amndt_ind in ('A', 'T')) as amended
      from g join newest n using (gkey)
      group by g.gkey, n.file_num, n.n
    ),
    after as (
      select g.*, case when g.tran_id <> ''
        then concat_ws('|', g.cmte_id, g.tran_id, g.transaction_tp, g.transaction_dt, g.amount,
          case when g.cand_id <> '' then g.cand_id else g.other_id end)
        else 'sub:' || g.sub_id end as dkey
      from g join groups gr using (gkey)
      where not (gr.n > gr.n_newest and gr.amended) or g.file_num = gr.newest
    )
    select distinct on (dkey) * from after
    order by dkey, file_num desc, (case when sub_id = '' then 0 else sub_id::numeric end) desc, seq`),
  );
  check();
  const [stats] = rowsOf<{ superseded: number; after: number; kept: number }>(
    await db.execute(
      sql.raw(`with g as (
        select case when tran_id <> ''
          then cmte_id || '|' || rpt_tp || '|' || tran_id || '|' || substr(transaction_dt, 5)
          else 'sub:' || sub_id end as gkey, file_num, amndt_ind
        from ${PAS2_STAGE}
      ),
      newest as (select gkey, max(file_num) as file_num, count(*) as n from g group by gkey),
      groups as (
        select n.n, count(*) filter (where g.file_num = n.file_num) as n_newest,
          bool_or(g.file_num = n.file_num and g.amndt_ind in ('A', 'T')) as amended
        from g join newest n using (gkey) group by g.gkey, n.file_num, n.n
      )
      select
        coalesce(sum(n - n_newest) filter (where n > n_newest and amended), 0)::int as superseded,
        ((select count(*) from ${PAS2_STAGE}) - coalesce(sum(n - n_newest) filter (where n > n_newest and amended), 0))::int as after,
        (select count(*) from ${PAS2_KEPT})::int as kept
      from groups`),
    ),
  );
  const superseded = stats?.superseded ?? 0;
  const kept = stats?.kept ?? 0;
  return { amendmentSuperseded: superseded, duplicateReports: (stats?.after ?? 0) - kept, kept };
}

export function keptPas2Pages(db: Db, check: Check = noCheck): AsyncGenerator<Pas2Row[]> {
  return pages(db, PAS2_KEPT, check, (r: Record<string, unknown>) => ({
    cmteId: String(r.cmte_id),
    amndtInd: String(r.amndt_ind),
    rptTp: String(r.rpt_tp),
    transactionTp: String(r.transaction_tp),
    transactionDt: String(r.transaction_dt),
    amount: String(r.amount),
    otherId: String(r.other_id),
    candId: String(r.cand_id),
    tranId: String(r.tran_id),
    fileNum: Number(r.file_num),
    memoCd: String(r.memo_cd),
    subId: String(r.sub_id),
  }));
}

export async function dropPas2Stage(db: Db): Promise<void> {
  await db.execute(sql.raw(`drop table if exists ${PAS2_STAGE}, ${PAS2_KEPT}`));
}

export async function createIeStage(db: Db, check: Check = noCheck): Promise<void> {
  await db.execute(sql.raw(`drop table if exists ${IE_STAGE}, ${IE_KEPT}`));
  check();
  await db.execute(
    sql.raw(`create temp table ${IE_STAGE} (
      seq bigint generated always as identity primary key,
      spender_id text not null, spender_name text not null, tran_id text not null,
      file_num bigint not null, prev_file_num bigint, candidate_id text not null,
      support_oppose text not null, amount_cents bigint not null, exp_date text,
      image_num text not null, purpose text)`),
  );
}

export async function stageIe(db: Db, rows: readonly IeStageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(
    (r) =>
      sql`(${r.spenderId}, ${r.spenderName}, ${r.tranId}, ${r.fileNum}, ${r.prevFileNum}, ${r.candidateId}, ${r.supportOppose}, ${r.amountCents}, ${r.date}, ${r.imageNum}, ${r.purpose})`,
  );
  await db.execute(
    sql`insert into ${sql.identifier(IE_STAGE)} (spender_id, spender_name, tran_id, file_num, prev_file_num, candidate_id, support_oppose, amount_cents, exp_date, image_num, purpose) values ${sql.join(values, sql`, `)}`,
  );
}

export interface IeSqlStats {
  invalidSupportOppose: number;
  superseded: number;
  duplicateReports: number;
  implausibleAmount: number;
  kept: number;
}

/** `dedupeIndependentExpenditures` in SQL: same rule order, same keys, same tie-breaks. */
export async function dedupeStagedIe(db: Db, check: Check = noCheck): Promise<IeSqlStats> {
  const classified = `
    select s.*, case
      when support_oppose not in ('S', 'O') then 'invalid'
      when file_num in (select prev_file_num from ${IE_STAGE} where prev_file_num is not null) then 'superseded'
      when abs(amount_cents) >= ${IE_IMPLAUSIBLE_CENTS} then 'implausible'
      else 'ok' end as class
    from ${IE_STAGE} s`;
  check();
  await db.execute(
    sql.raw(`create temp table ${IE_KEPT} as
    select distinct on (spender_id, tran_id, candidate_id, support_oppose, amount_cents, coalesce(exp_date, '')) *
    from (${classified}) c where class = 'ok'
    order by spender_id, tran_id, candidate_id, support_oppose, amount_cents, coalesce(exp_date, ''), file_num desc, seq`),
  );
  check();
  const [stats] = rowsOf<Record<keyof IeSqlStats | 'ok', number>>(
    await db.execute(
      sql.raw(`select
        (count(*) filter (where class = 'invalid'))::int as "invalidSupportOppose",
        (count(*) filter (where class = 'superseded'))::int as superseded,
        (count(*) filter (where class = 'implausible'))::int as "implausibleAmount",
        (count(*) filter (where class = 'ok'))::int as ok,
        (select count(*) from ${IE_KEPT})::int as kept
      from (${classified}) c`),
    ),
  );
  const kept = stats?.kept ?? 0;
  return {
    invalidSupportOppose: stats?.invalidSupportOppose ?? 0,
    superseded: stats?.superseded ?? 0,
    implausibleAmount: stats?.implausibleAmount ?? 0,
    duplicateReports: (stats?.ok ?? 0) - kept,
    kept,
  };
}

export function keptIePages(db: Db, check: Check = noCheck): AsyncGenerator<IeStageRow[]> {
  return pages(db, IE_KEPT, check, (r: Record<string, unknown>) => ({
    spenderId: String(r.spender_id),
    spenderName: String(r.spender_name),
    tranId: String(r.tran_id),
    fileNum: Number(r.file_num),
    prevFileNum: r.prev_file_num === null ? null : Number(r.prev_file_num),
    candidateId: String(r.candidate_id),
    supportOppose: String(r.support_oppose),
    amountCents: Number(r.amount_cents),
    date: r.exp_date === null ? null : String(r.exp_date),
    imageNum: String(r.image_num),
    purpose: r.purpose === null ? null : String(r.purpose),
  }));
}

export async function dropIeStage(db: Db): Promise<void> {
  await db.execute(sql.raw(`drop table if exists ${IE_STAGE}, ${IE_KEPT}`));
}

/** Keyset pages of a kept table in input order (`seq`); `check` runs before each page. */
async function* pages<T>(
  db: Db,
  table: string,
  check: Check,
  map: (row: Record<string, unknown>) => T,
): AsyncGenerator<T[]> {
  let after = 0;
  for (;;) {
    check();
    const query: SQL = sql`select * from ${sql.identifier(table)} where seq > ${after} order by seq limit ${BATCH_SIZE}`;
    const rows = rowsOf<Record<string, unknown>>(await db.execute(query));
    if (rows.length === 0) return;
    after = Number(rows.at(-1)?.seq);
    yield rows.map(map);
  }
}
