import {
  bill,
  billPolicyArea,
  billSubject,
  type Db,
  person,
  policyArea,
  rollcall,
  rollcallBill,
} from '@civic-ledger/db';
import { and, asc, desc, eq, ilike, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  CongressSchema,
  IsoDateSchema,
  PageSchema,
  PaginationInput,
  PersonRefSchema,
  ProvenanceSchema,
  RollcallRefSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

/** BILLSTATUS bill and resolution types, as stored (lower case). */
export const BILL_TYPES = [
  'hr',
  's',
  'hjres',
  'sjres',
  'hconres',
  'sconres',
  'hres',
  'sres',
] as const;
export type BillType = (typeof BILL_TYPES)[number];
export const BillTypeSchema = z
  .enum(BILL_TYPES)
  .describe('BILLSTATUS bill type in lower case: hr, s, hjres, sjres, hconres, sconres, hres, sres');

const BILL_TYPE_LABEL: Record<BillType, string> = {
  hr: 'H.R.',
  s: 'S.',
  hjres: 'H.J.Res.',
  sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.',
  sconres: 'S.Con.Res.',
  hres: 'H.Res.',
  sres: 'S.Res.',
};

const isBillType = (value: string): value is BillType =>
  (BILL_TYPES as readonly string[]).includes(value);

/** Congress.gov citation style: `H.R. 1`, `S.J.Res. 5`. */
export function billLabel(billType: string, number: number): string {
  return `${isBillType(billType) ? BILL_TYPE_LABEL[billType] : billType.toUpperCase()} ${number}`;
}

const BILL_NUMBER = /^(hr|s|hjres|sjres|hconres|sconres|hres|sres)(\d{1,6})$/;

/**
 * Reads a query as a bill number: `H.R. 1`, `hr1`, `HR 1`, `S 5`, `H.J.Res. 3`. Case, dots,
 * spaces and hyphens are ignored. Anything else is title text (null here).
 */
export function parseBillNumber(q: string): { billType: BillType; number: number } | null {
  const match = BILL_NUMBER.exec(q.toLowerCase().replaceAll(/[.\s-]/g, ''));
  if (!match) return null;
  const number = Number(match[2]);
  return number > 0 ? { billType: match[1] as BillType, number } : null;
}

/**
 * Coarse grouping of a roll call on a bill, from the source alone: `final_passage` when the
 * source marked the link as the passage vote (DECISIONS A23); otherwise `motion` when the
 * source's question contains the word "motion" (motions to recommit, table, suspend,
 * cloture), `amendment` when it contains "amendment", else `other`. The question and
 * description are always shown verbatim; this never characterises the vote.
 */
export const QUESTION_KINDS = ['final_passage', 'motion', 'amendment', 'other'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QuestionKindSchema = z
  .enum(QUESTION_KINDS)
  .describe(
    'final_passage = the source marks this as the passage vote; else motion / amendment when the source question contains that word; else other. Read the question text for the exact motion.',
  );

export function questionKind(question: string, isFinalPassage: boolean): QuestionKind {
  if (isFinalPassage) return 'final_passage';
  if (/\bmotion\b/i.test(question)) return 'motion';
  if (/\bamendment\b/i.test(question)) return 'amendment';
  return 'other';
}

export const BillSummarySchema = z.object({
  congress: CongressSchema,
  billType: z.string(),
  number: z.int().positive(),
  label: z.string().describe('Citation, e.g. "H.R. 1"; unique only together with congress'),
  title: z.string().describe('Official title as recorded by the source, unedited'),
  url: z.url().describe('Official source page for the bill'),
  introducedDate: IsoDateSchema.nullable(),
  provenance: ProvenanceSchema,
});

const billSummaryFields = {
  id: bill.id,
  congress: bill.congress,
  billType: bill.billType,
  number: bill.number,
  title: bill.title,
  url: bill.url,
  introducedDate: bill.introducedDate,
  ...provenanceFields(bill),
};

interface BillSummaryRow {
  id: number;
  congress: number;
  billType: string;
  number: number;
  title: string;
  url: string;
  introducedDate: string | null;
  sourceId: string;
  sourceKey: string;
  ingestRunId: number;
  retrievedAt: Date;
}

function toSummary({ id: _id, ...row }: BillSummaryRow) {
  return { ...withProvenance(row), label: billLabel(row.billType, row.number) };
}

// ---------------------------------------------------------------------------------------------
// bills.search@1

export const BillsSearchInput = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'A bill number ("H.R. 1", "hr1", "S 5") or words from the official title. Omit to list every bill.',
    ),
  congress: CongressSchema.optional(),
  ...PaginationInput,
});

export const BillsSearchOutput = z.object({
  query: z
    .object({
      interpretedAs: z.enum(['bill_number', 'title_text', 'none']),
      billType: z.string().nullable(),
      number: z.int().nullable(),
    })
    .describe('How `q` was read; a bill number matches that number in every congress'),
  items: z.array(BillSummarySchema),
  ...PageSchema,
});

export const billsSearch = defineCapability({
  name: 'bills.search',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Find bills by number ("H.R. 1", "hr1", "S 5") or official title words, newest congress first.',
  input: BillsSearchInput,
  output: BillsSearchOutput,
  async handler({ db }, input) {
    const parsed = input.q ? parseBillNumber(input.q) : null;
    const textFilter: SQL | undefined =
      input.q && !parsed ? ilike(bill.title, `%${escapeLike(input.q)}%`) : undefined;
    const where = and(
      input.congress ? eq(bill.congress, input.congress) : undefined,
      parsed ? and(eq(bill.billType, parsed.billType), eq(bill.number, parsed.number)) : undefined,
      textFilter,
    );
    const [rows, [count]] = await Promise.all([
      db
        .select(billSummaryFields)
        .from(bill)
        .where(where)
        .orderBy(desc(bill.congress), asc(bill.billType), asc(bill.number))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(bill).where(where),
    ]);
    return {
      query: {
        interpretedAs: parsed ? ('bill_number' as const) : input.q ? ('title_text' as const) : ('none' as const),
        billType: parsed?.billType ?? null,
        number: parsed?.number ?? null,
      },
      items: rows.map(toSummary),
      total: count?.total ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  },
});

/** `%`, `_` and `\` in user text are literal in an ILIKE pattern. */
function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------------------------
// bills.get@1

export const RollcallDetailRefSchema = RollcallRefSchema.extend({
  description: z
    .string()
    .nullable()
    .describe('Source description of the question (e.g. which amendment); null when none'),
  provenance: ProvenanceSchema,
});

export const BillsGetInput = z.strictObject({
  congress: CongressSchema,
  billType: BillTypeSchema,
  number: z.int().positive(),
});

export const BillsGetOutput = z.object({
  bill: BillSummarySchema,
  sponsor: z
    .object({
      status: z.enum(['recorded', 'unknown']),
      person: PersonRefSchema.nullable(),
    })
    .describe(
      '`unknown` when the source names no sponsor or the sponsor is not matched to a member record. Provenance: bill.provenance.',
    ),
  latestAction: z
    .object({
      status: z.enum(['recorded', 'unknown']),
      text: z.string().nullable(),
      date: IsoDateSchema.nullable(),
    })
    .describe(
      'The single latest action the source recorded when retrieved (bill.provenance). Not an action history.',
    ),
  policyAreas: z.array(
    z.object({ id: z.string(), name: z.string(), provenance: ProvenanceSchema }),
  ),
  subjects: z.array(z.object({ subject: z.string(), provenance: ProvenanceSchema })),
  rollcalls: z
    .array(
      z.object({
        rollcall: RollcallDetailRefSchema,
        isFinalPassage: z.boolean(),
        questionKind: QuestionKindSchema,
        linkProvenance: ProvenanceSchema.describe('Where the bill-to-roll-call link came from'),
      }),
    )
    .describe('Roll calls the source links to this bill, oldest first'),
});

export const billsGet = defineCapability({
  name: 'bills.get',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'One bill (congress + type + number): official title, sponsor, latest action, policy areas, subjects and its roll calls.',
  input: BillsGetInput,
  output: BillsGetOutput,
  async handler({ db }, input) {
    const [row] = await db
      .select({
        ...billSummaryFields,
        latestActionText: bill.latestActionText,
        latestActionDate: bill.latestActionDate,
        sponsorSlug: person.slug,
        sponsorName: person.fullName,
      })
      .from(bill)
      .leftJoin(person, eq(person.id, bill.sponsorPersonId))
      .where(
        and(
          eq(bill.congress, input.congress),
          eq(bill.billType, input.billType),
          eq(bill.number, input.number),
        ),
      )
      .limit(1);
    if (!row) {
      throw notFound(
        `No bill ${billLabel(input.billType, input.number)} in congress ${input.congress}`,
      );
    }
    const { latestActionText, latestActionDate, sponsorSlug, sponsorName, ...summary } = row;
    const [areas, subjects, rollcalls] = await Promise.all([
      db
        .select({ id: policyArea.id, name: policyArea.name, ...provenanceFields(billPolicyArea) })
        .from(billPolicyArea)
        .innerJoin(policyArea, eq(policyArea.id, billPolicyArea.policyAreaId))
        .where(eq(billPolicyArea.billId, row.id))
        .orderBy(asc(policyArea.name)),
      db
        .select({ subject: billSubject.subject, ...provenanceFields(billSubject) })
        .from(billSubject)
        .where(eq(billSubject.billId, row.id))
        .orderBy(asc(billSubject.subject)),
      rollcallsForBill(db, row.id),
    ]);
    return {
      bill: toSummary(summary),
      sponsor:
        sponsorSlug !== null && sponsorName !== null
          ? { status: 'recorded' as const, person: { slug: sponsorSlug, fullName: sponsorName } }
          : { status: 'unknown' as const, person: null },
      latestAction: {
        status:
          latestActionText !== null || latestActionDate !== null
            ? ('recorded' as const)
            : ('unknown' as const),
        text: latestActionText,
        date: latestActionDate,
      },
      policyAreas: areas.map(withProvenance),
      subjects: subjects.map(withProvenance),
      rollcalls,
    };
  },
});

async function rollcallsForBill(db: Db, billId: number) {
  const rows = await db
    .select({
      congress: rollcall.congress,
      chamber: rollcall.chamber,
      number: rollcall.number,
      session: rollcall.session,
      clerkNumber: rollcall.clerkNumber,
      voteDate: rollcall.voteDate,
      question: rollcall.question,
      description: rollcall.description,
      result: rollcall.result,
      ...provenanceFields(rollcall),
      isFinalPassage: rollcallBill.isFinalPassage,
      linkSourceId: rollcallBill.sourceId,
      linkSourceKey: rollcallBill.sourceKey,
      linkIngestRunId: rollcallBill.ingestRunId,
      linkRetrievedAt: rollcallBill.retrievedAt,
    })
    .from(rollcallBill)
    .innerJoin(rollcall, eq(rollcall.id, rollcallBill.rollcallId))
    .where(eq(rollcallBill.billId, billId))
    .orderBy(asc(rollcall.voteDate), asc(rollcall.chamber), asc(rollcall.number));
  return rows.map(
    ({ isFinalPassage, linkSourceId, linkSourceKey, linkIngestRunId, linkRetrievedAt, ...rc }) => ({
      rollcall: withProvenance(rc),
      isFinalPassage,
      questionKind: questionKind(rc.question, isFinalPassage),
      linkProvenance: {
        sourceId: linkSourceId,
        sourceKey: linkSourceKey,
        ingestRunId: linkIngestRunId,
        retrievedAt: linkRetrievedAt.toISOString(),
      },
    }),
  );
}
