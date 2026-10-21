import { type Db, independentExpenditure } from '@civic-ledger/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CentsSchema, IsoDateSchema, ProvenanceSchema } from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

/** Itemized expenditures returned per member; `spenders` always covers every one. */
export const OUTSIDE_ITEMS_LIMIT = 50;

const SupportOpposeSchema = z.enum(['support', 'oppose']);

export const OutsideSpendingSchema = z.object({
  supportCents: CentsSchema,
  opposeCents: CentsSchema,
  spenders: z
    .array(
      z.object({
        spenderFecCommitteeId: z.string(),
        spenderName: z.string(),
        supportOppose: SupportOpposeSchema,
        amountCents: CentsSchema,
        expenditures: z.int().min(1),
        latestDate: IsoDateSchema.nullable(),
      }),
    )
    .describe('Every spender and side, summed over all its expenditures, largest first'),
  itemCount: z.int().min(0).describe('All expenditures; `items` lists the largest of them'),
  items: z
    .array(
      z.object({
        spenderName: z.string(),
        supportOppose: SupportOpposeSchema,
        amountCents: CentsSchema,
        expenditureDate: IsoDateSchema.nullable(),
        purpose: z.string().nullable(),
        provenance: ProvenanceSchema,
      }),
    )
    .describe(`The ${OUTSIDE_ITEMS_LIMIT} largest expenditures`),
});
export type OutsideSpending = z.infer<typeof OutsideSpendingSchema>;

export const emptyOutsideSpending = (): OutsideSpending => ({
  supportCents: 0,
  opposeCents: 0,
  spenders: [],
  itemCount: 0,
  items: [],
});

export async function loadOutsideSpending(
  db: Db,
  personId: number,
  cycle: number,
): Promise<OutsideSpending> {
  const ie = independentExpenditure;
  const rows = await db
    .select({
      spenderFecCommitteeId: ie.spenderFecCommitteeId,
      spenderName: ie.spenderName,
      supportOppose: ie.supportOppose,
      amountCents: ie.amountCents,
      expenditureDate: ie.expenditureDate,
      purpose: ie.purpose,
      ...provenanceFields(ie),
    })
    .from(ie)
    .where(and(eq(ie.personId, personId), eq(ie.cycle, cycle)))
    .orderBy(desc(ie.amountCents), ie.fecTransactionId);

  const spenders = new Map<string, OutsideSpending['spenders'][number]>();
  for (const r of rows) {
    const key = `${r.spenderFecCommitteeId}|${r.supportOppose}`;
    const s = spenders.get(key) ?? {
      spenderFecCommitteeId: r.spenderFecCommitteeId,
      spenderName: r.spenderName,
      supportOppose: r.supportOppose,
      amountCents: 0,
      expenditures: 0,
      latestDate: null,
    };
    s.amountCents += r.amountCents;
    s.expenditures += 1;
    if (r.expenditureDate && (!s.latestDate || r.expenditureDate > s.latestDate)) {
      s.latestDate = r.expenditureDate;
    }
    spenders.set(key, s);
  }
  const total = (side: 'support' | 'oppose') =>
    rows.filter((r) => r.supportOppose === side).reduce((n, r) => n + r.amountCents, 0);
  return {
    supportCents: total('support'),
    opposeCents: total('oppose'),
    spenders: [...spenders.values()].sort(
      (a, b) => b.amountCents - a.amountCents || a.spenderName.localeCompare(b.spenderName),
    ),
    itemCount: rows.length,
    items: rows
      .slice(0, OUTSIDE_ITEMS_LIMIT)
      .map(({ spenderFecCommitteeId: _id, ...r }) => withProvenance(r)),
  };
}

export interface OutsideTotals {
  supportCents: number;
  opposeCents: number;
  /** Expenditures kept after the ingest dedupe and amendment rules. */
  expenditures: number;
}

/**
 * Support / oppose totals per FEC candidate id for one cycle: the race view of the same
 * `independent_expenditure` rows `loadOutsideSpending` sums per person. The dedupe and
 * amendment rules (superseded filings, duplicate reports, implausible amounts; DECISIONS
 * A12, A13, A53) run once at ingest, so both views read already-reconciled rows and
 * differ only in the key: a person (all of their FEC ids) versus one FEC candidate id.
 */
export async function loadOutsideTotalsByFecId(
  db: Db,
  fecCandidateIds: readonly string[],
  cycle: number,
): Promise<Map<string, OutsideTotals>> {
  const out = new Map<string, OutsideTotals>();
  if (fecCandidateIds.length === 0) return out;
  const ie = independentExpenditure;
  const sum = sql<number>`coalesce(sum(${ie.amountCents}), 0)::bigint`.mapWith(Number);
  const rows = await db
    .select({
      fecCandidateId: ie.candidateFecId,
      supportOppose: ie.supportOppose,
      amountCents: sum,
      expenditures: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(ie)
    .where(and(inArray(ie.candidateFecId, [...fecCandidateIds]), eq(ie.cycle, cycle)))
    .groupBy(ie.candidateFecId, ie.supportOppose);
  for (const r of rows) {
    const t = out.get(r.fecCandidateId) ?? { supportCents: 0, opposeCents: 0, expenditures: 0 };
    if (r.supportOppose === 'support') t.supportCents += r.amountCents;
    else t.opposeCents += r.amountCents;
    t.expenditures += r.expenditures;
    out.set(r.fecCandidateId, t);
  }
  return out;
}
