import { type Db, independentExpenditure } from '@civic-ledger/db';
import { and, desc, eq } from 'drizzle-orm';
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
