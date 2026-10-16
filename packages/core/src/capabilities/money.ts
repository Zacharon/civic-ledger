import {
  candidateCycleSummary,
  candidateCycleTotals,
  committee,
  committeeContribution,
  committeeIndustry,
  type Db,
  industry,
  person,
} from '@civic-ledger/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  CentsSchema,
  CycleSchema,
  IsoDateSchema,
  PersonRefSchema,
  ProvenanceSchema,
  ShareSchema,
  SlugSchema,
} from '../schemas/common';
import { withProvenance } from '../schemas/provenance';
import {
  emptyOutsideSpending,
  loadOutsideSpending,
  OutsideSpendingSchema,
} from './outside-spending';

const TOP_COMMITTEES = 10;

const IndustryRefSchema = z.object({ id: z.string(), name: z.string(), sector: z.string() });

export const MoneySummaryInput = z.strictObject({
  slug: SlugSchema,
  cycle: CycleSchema.optional().describe('Defaults to the latest cycle with FEC totals'),
});

export const MoneySummaryOutput = z.object({
  person: PersonRefSchema,
  cycle: CycleSchema.nullable().describe('null when no FEC totals exist for this person'),
  availableCycles: z.array(CycleSchema),
  totals: z
    .object({
      fecCandidateId: z.string(),
      totalReceiptsCents: CentsSchema,
      individualCents: CentsSchema,
      unitemizedIndividualCents: CentsSchema.nullable().describe(
        'Always null from weball (no itemized split); see smallDollar',
      ),
      otherCommitteeCents: CentsSchema.describe('From PACs and other committees'),
      partyCents: CentsSchema,
      candidateSelfCents: CentsSchema,
      totalDisbursementsCents: CentsSchema,
      cashOnHandCents: CentsSchema,
      debtsCents: CentsSchema,
      coverageEndDate: IsoDateSchema.nullable(),
      pacShare: ShareSchema.nullable(),
      smallDollarShare: ShareSchema.nullable().describe('Same as smallDollar.share'),
      provenance: ProvenanceSchema,
    })
    .nullable(),
  smallDollar: z
    .object({
      fecCandidateId: z.string(),
      unitemizedIndividualCents: CentsSchema.describe('Donors giving $200 or less in the cycle'),
      itemizedIndividualCents: CentsSchema,
      totalReceiptsCents: CentsSchema.describe('Total receipts in the same summary period'),
      share: ShareSchema.nullable().describe(
        'unitemized / total receipts of this summary; null when outside [0, 1] or receipts <= 0',
      ),
      coverageEndDate: IsoDateSchema.nullable().describe('Can trail totals.coverageEndDate'),
      provenance: ProvenanceSchema,
    })
    .nullable()
    .describe('FEC candidate summary: the itemized / unitemized split weball lacks'),
  industryCoding: z
    .object({
      totalCents: CentsSchema.describe('Net itemized committee contributions this cycle'),
      grossCents: CentsSchema.describe('Positive contributions only, before refunds'),
      refundsCents: CentsSchema.describe('Refunds and other negative entries, as a negative sum'),
      codedCents: CentsSchema.describe('Net, coded committees'),
      uncodedCents: CentsSchema.describe(
        'Net; shown as "not coded", never folded into an industry',
      ),
      codedGrossCents: CentsSchema,
      uncodedGrossCents: CentsSchema,
      coverage: ShareSchema.nullable().describe(
        'codedGrossCents / grossCents; null when there are no positive contributions',
      ),
    })
    .describe(
      'Coverage and shares use gross positive dollars so refunds cannot push them outside [0, 1]',
    ),
  industries: z
    .array(
      z.object({
        industry: IndustryRefSchema,
        amountCents: CentsSchema.describe('Net after refunds'),
        grossCents: CentsSchema,
        refundsCents: CentsSchema,
        share: ShareSchema.describe('grossCents / industryCoding.grossCents'),
      }),
    )
    .describe('Coded industries with positive gross contributions, largest net first'),
  topCommittees: z
    .array(
      z.object({
        fecCommitteeId: z.string(),
        name: z.string(),
        amountCents: CentsSchema.describe('Net after refunds; only committees with net > 0'),
        industry: IndustryRefSchema.nullable().describe('null = not coded'),
      }),
    )
    .describe('Largest net givers'),
  outsideSpending: OutsideSpendingSchema,
});

export const moneySummary = defineCapability({
  name: 'money.summary',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'FEC totals, PAC money by industry (with coding coverage) and outside spending.',
  input: MoneySummaryInput,
  output: MoneySummaryOutput,
  async handler({ db }, input) {
    const [who] = await db
      .select({ id: person.id, slug: person.slug, fullName: person.fullName })
      .from(person)
      .where(eq(person.slug, input.slug))
      .limit(1);
    if (!who) throw notFound(`No person with slug "${input.slug}"`);

    const cycles = await db
      .selectDistinct({ cycle: candidateCycleTotals.cycle })
      .from(candidateCycleTotals)
      .where(eq(candidateCycleTotals.personId, who.id))
      .orderBy(desc(candidateCycleTotals.cycle));
    const availableCycles = cycles.map((c) => c.cycle);
    const cycle = input.cycle ?? availableCycles[0] ?? null;
    const personRef = { slug: who.slug, fullName: who.fullName };
    if (cycle === null) {
      return { person: personRef, cycle, availableCycles, ...emptyMoney() };
    }

    const [totals, smallDollar, industries, topCommittees, outsideSpending] = await Promise.all([
      loadTotals(db, who.id, cycle),
      loadSmallDollar(db, who.id, cycle),
      loadIndustries(db, who.id, cycle),
      loadTopCommittees(db, who.id, cycle),
      loadOutsideSpending(db, who.id, cycle),
    ]);
    return {
      person: personRef,
      cycle,
      availableCycles,
      totals: totals ? { ...totals, smallDollarShare: smallDollar?.share ?? null } : null,
      smallDollar,
      ...industries,
      topCommittees,
      outsideSpending,
    };
  },
});

function emptyMoney() {
  return {
    totals: null,
    smallDollar: null,
    industryCoding: {
      totalCents: 0,
      grossCents: 0,
      refundsCents: 0,
      codedCents: 0,
      uncodedCents: 0,
      codedGrossCents: 0,
      uncodedGrossCents: 0,
      coverage: null,
    },
    industries: [],
    topCommittees: [],
    outsideSpending: emptyOutsideSpending(),
  };
}

async function loadTotals(db: Db, personId: number, cycle: number) {
  const t = candidateCycleTotals;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.personId, personId), eq(t.cycle, cycle)))
    .orderBy(desc(t.totalReceiptsCents))
    .limit(1);
  if (!row) return null;
  const share = (part: number | null) => shareOf(part, row.totalReceiptsCents);
  return {
    fecCandidateId: row.fecCandidateId,
    totalReceiptsCents: row.totalReceiptsCents,
    individualCents: row.individualCents,
    unitemizedIndividualCents: row.unitemizedIndividualCents,
    otherCommitteeCents: row.otherCommitteeCents,
    partyCents: row.partyCents,
    candidateSelfCents: row.candidateSelfCents,
    totalDisbursementsCents: row.totalDisbursementsCents,
    cashOnHandCents: row.cashOnHandCents,
    debtsCents: row.debtsCents,
    coverageEndDate: row.coverageEndDate,
    pacShare: share(row.otherCommitteeCents),
    smallDollarShare: null,
    provenance: withProvenance(row).provenance,
  };
}

async function loadSmallDollar(db: Db, personId: number, cycle: number) {
  const t = candidateCycleSummary;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.personId, personId), eq(t.cycle, cycle)))
    .limit(1);
  if (!row) return null;
  return {
    fecCandidateId: row.fecCandidateId,
    unitemizedIndividualCents: row.unitemizedIndividualCents,
    itemizedIndividualCents: row.itemizedIndividualCents,
    totalReceiptsCents: row.totalReceiptsCents,
    share: shareOf(row.unitemizedIndividualCents, row.totalReceiptsCents),
    coverageEndDate: row.coverageEndDate,
    provenance: withProvenance(row).provenance,
  };
}

const sumCents = sql<number>`sum(${committeeContribution.amountCents})::bigint`.mapWith(Number);
const grossCents =
  sql<number>`coalesce(sum(${committeeContribution.amountCents}) filter (where ${committeeContribution.amountCents} > 0), 0)::bigint`.mapWith(
    Number,
  );

/** part / base, only when the base is positive and the part lies in [0, base]. */
export function shareOf(part: number | null, base: number): number | null {
  if (part === null || base <= 0 || part < 0 || part > base) return null;
  return part / base;
}

export interface IndustryAmounts {
  id: string | null;
  name: string | null;
  sector: string | null;
  netCents: number;
  grossCents: number;
}

/**
 * Coverage and shares over gross positive contributions; net amounts (after refunds) are
 * reported beside them. A refund-heavy uncoded group can make net sums negative, so a
 * net-based coverage could exceed 1 or drop below 0 (seen on real 2026 data).
 */
export function industryBreakdown(rows: readonly IndustryAmounts[]) {
  const sum = (items: readonly IndustryAmounts[], key: 'netCents' | 'grossCents') =>
    items.reduce((n, r) => n + r[key], 0);
  const coded = rows.filter((r) => r.id !== null);
  const uncoded = rows.filter((r) => r.id === null);
  const total = sum(rows, 'grossCents');
  const totalNet = sum(rows, 'netCents');
  const codedGross = sum(coded, 'grossCents');
  const industries = coded
    .flatMap(({ id, name, sector, netCents, grossCents: gross }) =>
      id === null || name === null || sector === null || gross <= 0
        ? []
        : [
            {
              industry: { id, name, sector },
              amountCents: netCents,
              grossCents: gross,
              refundsCents: netCents - gross,
              share: gross / total,
            },
          ],
    )
    .sort((a, b) => b.amountCents - a.amountCents || a.industry.id.localeCompare(b.industry.id));
  return {
    industryCoding: {
      totalCents: totalNet,
      grossCents: total,
      refundsCents: totalNet - total,
      codedCents: sum(coded, 'netCents'),
      uncodedCents: sum(uncoded, 'netCents'),
      codedGrossCents: codedGross,
      uncodedGrossCents: total - codedGross,
      coverage: total > 0 ? codedGross / total : null,
    },
    industries,
  };
}

async function loadIndustries(db: Db, personId: number, cycle: number) {
  const rows = await db
    .select({
      id: industry.id,
      name: industry.name,
      sector: industry.sector,
      netCents: sumCents,
      grossCents,
    })
    .from(committeeContribution)
    .leftJoin(
      committeeIndustry,
      eq(committeeIndustry.committeeId, committeeContribution.committeeId),
    )
    .leftJoin(industry, eq(industry.id, committeeIndustry.industryId))
    .where(
      and(eq(committeeContribution.personId, personId), eq(committeeContribution.cycle, cycle)),
    )
    .groupBy(industry.id, industry.name, industry.sector);
  return industryBreakdown(rows);
}

async function loadTopCommittees(db: Db, personId: number, cycle: number) {
  const rows = await db
    .select({
      fecCommitteeId: committee.fecCommitteeId,
      name: committee.name,
      amountCents: sumCents,
      industryId: industry.id,
      industryName: industry.name,
      industrySector: industry.sector,
    })
    .from(committeeContribution)
    .innerJoin(committee, eq(committee.id, committeeContribution.committeeId))
    .leftJoin(committeeIndustry, eq(committeeIndustry.committeeId, committee.id))
    .leftJoin(industry, eq(industry.id, committeeIndustry.industryId))
    .where(
      and(eq(committeeContribution.personId, personId), eq(committeeContribution.cycle, cycle)),
    )
    .groupBy(committee.fecCommitteeId, committee.name, industry.id, industry.name, industry.sector)
    .having(sql`sum(${committeeContribution.amountCents}) > 0`)
    .orderBy(desc(sumCents), committee.fecCommitteeId)
    .limit(TOP_COMMITTEES);
  return rows.map((r) => ({
    fecCommitteeId: r.fecCommitteeId,
    name: r.name,
    amountCents: r.amountCents,
    industry:
      r.industryId === null || r.industryName === null || r.industrySector === null
        ? null
        : { id: r.industryId, name: r.industryName, sector: r.industrySector },
  }));
}
