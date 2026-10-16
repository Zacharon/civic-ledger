import {
  candidateCycleTotals,
  committee,
  committeeContribution,
  committeeIndustry,
  type Db,
  independentExpenditure,
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
import { provenanceFields, withProvenance } from '../schemas/provenance';

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
      unitemizedIndividualCents: CentsSchema.nullable(),
      otherCommitteeCents: CentsSchema.describe('From PACs and other committees'),
      partyCents: CentsSchema,
      candidateSelfCents: CentsSchema,
      totalDisbursementsCents: CentsSchema,
      cashOnHandCents: CentsSchema,
      debtsCents: CentsSchema,
      coverageEndDate: IsoDateSchema.nullable(),
      pacShare: ShareSchema.nullable(),
      smallDollarShare: ShareSchema.nullable(),
      provenance: ProvenanceSchema,
    })
    .nullable(),
  industryCoding: z.object({
    totalCents: CentsSchema.describe('Itemized committee contributions this cycle'),
    codedCents: CentsSchema,
    uncodedCents: CentsSchema.describe('Shown as "not coded", never folded into an industry'),
    coverage: ShareSchema.nullable().describe(
      'codedCents / totalCents; null when no contributions',
    ),
  }),
  industries: z.array(
    z.object({ industry: IndustryRefSchema, amountCents: CentsSchema, share: ShareSchema }),
  ),
  topCommittees: z.array(
    z.object({
      fecCommitteeId: z.string(),
      name: z.string(),
      amountCents: CentsSchema,
      industry: IndustryRefSchema.nullable().describe('null = not coded'),
    }),
  ),
  outsideSpending: z.object({
    supportCents: CentsSchema,
    opposeCents: CentsSchema,
    items: z.array(
      z.object({
        spenderName: z.string(),
        supportOppose: z.enum(['support', 'oppose']),
        amountCents: CentsSchema,
        expenditureDate: IsoDateSchema.nullable(),
        purpose: z.string().nullable(),
        provenance: ProvenanceSchema,
      }),
    ),
  }),
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

    const [totals, industries, topCommittees, outsideSpending] = await Promise.all([
      loadTotals(db, who.id, cycle),
      loadIndustries(db, who.id, cycle),
      loadTopCommittees(db, who.id, cycle),
      loadOutsideSpending(db, who.id, cycle),
    ]);
    return {
      person: personRef,
      cycle,
      availableCycles,
      totals,
      ...industries,
      topCommittees,
      outsideSpending,
    };
  },
});

function emptyMoney() {
  return {
    totals: null,
    industryCoding: { totalCents: 0, codedCents: 0, uncodedCents: 0, coverage: null },
    industries: [],
    topCommittees: [],
    outsideSpending: { supportCents: 0, opposeCents: 0, items: [] },
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
  const share = (part: number | null) =>
    part === null || row.totalReceiptsCents <= 0 ? null : part / row.totalReceiptsCents;
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
    smallDollarShare: share(row.unitemizedIndividualCents),
    provenance: withProvenance(row).provenance,
  };
}

const sumCents = sql<number>`sum(${committeeContribution.amountCents})::bigint`.mapWith(Number);

async function loadIndustries(db: Db, personId: number, cycle: number) {
  const rows = await db
    .select({
      id: industry.id,
      name: industry.name,
      sector: industry.sector,
      amountCents: sumCents,
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
    .groupBy(industry.id, industry.name, industry.sector)
    .orderBy(desc(sumCents), industry.id);

  const totalCents = rows.reduce((n, r) => n + r.amountCents, 0);
  const uncodedCents = rows.filter((r) => r.id === null).reduce((n, r) => n + r.amountCents, 0);
  const codedCents = totalCents - uncodedCents;
  const industries = rows.flatMap(({ id, name, sector, amountCents }) =>
    id === null || name === null || sector === null
      ? []
      : [{ industry: { id, name, sector }, amountCents, share: amountCents / totalCents }],
  );
  return {
    industryCoding: {
      totalCents,
      codedCents,
      uncodedCents,
      coverage: totalCents > 0 ? codedCents / totalCents : null,
    },
    industries,
  };
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

async function loadOutsideSpending(db: Db, personId: number, cycle: number) {
  const ie = independentExpenditure;
  const rows = await db
    .select({
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
  const total = (side: 'support' | 'oppose') =>
    rows.filter((r) => r.supportOppose === side).reduce((n, r) => n + r.amountCents, 0);
  return {
    supportCents: total('support'),
    opposeCents: total('oppose'),
    items: rows.map(withProvenance),
  };
}
