import { person, rollcall, term, votePosition } from '@civic-ledger/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  ChamberSchema,
  CongressSchema,
  PersonRefSchema,
  ProvenanceSchema,
  ShareSchema,
  SlugSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/**
 * What a month means for this member. Statuses are never merged (DESIGN.md): "no votes
 * held" is a fact about the chamber, "not yet serving" a fact about the member, and
 * "no record" says a vote was held while the member served but none is on file for them.
 */
export const ATTENDANCE_STATUSES = [
  'served',
  'no_votes_held',
  'not_yet_serving',
  'no_longer_serving',
  'not_serving',
  'no_record',
] as const;
export const AttendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const AttendanceMonthSchema = z.object({
  month: MonthSchema,
  status: AttendanceStatusSchema,
  rollcallsHeld: z
    .int()
    .min(0)
    .describe("Roll calls held that month in the chamber(s) where this member's votes are on file"),
  eligible: z
    .int()
    .min(0)
    .describe('Recorded positions for this member: yea + nay + present + not voting'),
  missed: z.int().min(0).describe('Not voting'),
  present: z.int().min(0).describe('Present (an official position, not a missed vote)'),
  voted: z.int().min(0).describe('Yea + nay'),
});
export type AttendanceMonth = z.infer<typeof AttendanceMonthSchema>;

export const VotesAttendanceInput = z.strictObject({
  slug: SlugSchema,
  congress: CongressSchema.optional().describe(
    'Defaults to the latest Congress with votes on file for this member (the one behind the Explore missed-vote column)',
  ),
});

export const VotesAttendanceOutput = z.object({
  person: PersonRefSchema,
  congress: CongressSchema.nullable().describe('Null when this member has no votes on file'),
  chambers: z.array(ChamberSchema).describe('Chambers where this member has votes on file'),
  throughMonth: MonthSchema.nullable().describe(
    'Last month with any roll call on file in this Congress; later months are not shown',
  ),
  months: z.array(AttendanceMonthSchema),
  totals: z.object({
    eligible: z.int().min(0),
    missed: z.int().min(0),
    present: z.int().min(0),
    voted: z.int().min(0),
    missedRate: ShareSchema.nullable().describe('missed / eligible; null when eligible is 0'),
  }),
  definition: z.string(),
  provenance: ProvenanceSchema.nullable().describe(
    'Most recently loaded vote position behind these counts; null when none',
  ),
});

const DEFINITION =
  'Eligible votes are the roll-call positions on file for the member in the Congress (yea, nay, present and not voting). Missed votes are the ones recorded as not voting; present is a separate official position and is not missed. This is the same count and rate as the Explore "missed votes" column.';

interface TermRange {
  startDate: string;
  endDate: string | null;
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** First calendar year of a Congress (the 1st Congress began in 1789; each lasts two years). */
export function congressStartYear(congress: number): number {
  return 1789 + 2 * (congress - 1);
}

/** Every month from January of the Congress's first year to `throughMonth`, inclusive. */
export function monthsBetween(congress: number, throughMonth: string): string[] {
  const out: string[] = [];
  const [endYear, endMonth] = throughMonth.split('-').map(Number) as [number, number];
  for (let year = congressStartYear(congress); year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === endYear && month > endMonth) return out;
      out.push(monthKey(year, month));
    }
  }
  return out;
}

function servedIn(month: string, terms: TermRange[]): boolean {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const start = `${month}-01`;
  const next = m === 12 ? monthKey(year + 1, 1) : monthKey(year, m + 1);
  const end = `${next}-01`;
  return terms.some((t) => t.startDate < end && (t.endDate === null || t.endDate > start));
}

export interface AttendanceCounts {
  eligible: number;
  missed: number;
  present: number;
  voted: number;
}

/**
 * Pure month classification (unit-tested without a database). `counts` are the member's
 * positions by month, `held` the roll calls held by month in the member's chambers.
 * Positions on file always win: a month with recorded positions is `served`, whatever the
 * term dates say.
 */
export function buildMonths(input: {
  months: string[];
  counts: Map<string, AttendanceCounts>;
  held: Map<string, number>;
  terms: TermRange[];
}): AttendanceMonth[] {
  const serving = input.months.map((m) => servedIn(m, input.terms));
  return input.months.map((month, i) => {
    const counts = input.counts.get(month) ?? { eligible: 0, missed: 0, present: 0, voted: 0 };
    const rollcallsHeld = input.held.get(month) ?? 0;
    let status: AttendanceStatus;
    if (counts.eligible > 0) status = 'served';
    else if (!serving[i]) {
      const before = serving.slice(0, i).some(Boolean);
      const after = serving.slice(i + 1).some(Boolean);
      status =
        !before && after
          ? 'not_yet_serving'
          : before && !after
            ? 'no_longer_serving'
            : 'not_serving';
    } else status = rollcallsHeld === 0 ? 'no_votes_held' : 'no_record';
    return { month, status, rollcallsHeld, ...counts };
  });
}

export const votesAttendance = defineCapability({
  name: 'votes.attendance',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Month-by-month eligible, missed (not voting) and present roll-call votes for one member in one Congress, with months that had no votes or before service kept distinct.',
  input: VotesAttendanceInput,
  output: VotesAttendanceOutput,
  async handler({ db }, input) {
    const [who] = await db
      .select({ id: person.id, slug: person.slug, fullName: person.fullName })
      .from(person)
      .where(eq(person.slug, input.slug))
      .limit(1);
    if (!who) throw notFound(`No person with slug "${input.slug}"`);

    let congress = input.congress ?? null;
    if (congress === null) {
      const [latest] = await db
        .select({ congress: sql<number | null>`max(${rollcall.congress})` })
        .from(votePosition)
        .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
        .where(eq(votePosition.personId, who.id));
      congress = latest?.congress ?? null;
    }
    const person_ = { slug: who.slug, fullName: who.fullName };
    if (congress === null) return emptyResult(person_, null);

    const month = sql<string>`to_char(${rollcall.voteDate}, 'YYYY-MM')`;
    const [countRows, heldRows, termRows, [last], [through], [latest]] = await Promise.all([
      db
        .select({
          month,
          chamber: rollcall.chamber,
          eligible: sql<number>`count(*)::int`,
          missed: sql<number>`(count(*) filter (where ${votePosition.position} = 'not_voting'))::int`,
          present: sql<number>`(count(*) filter (where ${votePosition.position} = 'present'))::int`,
          voted: sql<number>`(count(*) filter (where ${votePosition.position} in ('yea', 'nay')))::int`,
        })
        .from(votePosition)
        .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
        .where(and(eq(votePosition.personId, who.id), eq(rollcall.congress, congress)))
        .groupBy(month, rollcall.chamber),
      db
        .select({ month, chamber: rollcall.chamber, held: sql<number>`count(*)::int` })
        .from(rollcall)
        .where(eq(rollcall.congress, congress))
        .groupBy(month, rollcall.chamber),
      db
        .select({ startDate: term.startDate, endDate: term.endDate })
        .from(term)
        .where(eq(term.personId, who.id)),
      db
        .select({ one: sql<number>`1` })
        .from(rollcall)
        .where(eq(rollcall.congress, congress))
        .limit(1),
      db
        .select({ month: sql<string | null>`to_char(max(${rollcall.voteDate}), 'YYYY-MM')` })
        .from(rollcall)
        .where(eq(rollcall.congress, congress)),
      db
        .select(provenanceFields(votePosition))
        .from(votePosition)
        .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
        .where(and(eq(votePosition.personId, who.id), eq(rollcall.congress, congress)))
        .orderBy(desc(votePosition.retrievedAt), desc(votePosition.id))
        .limit(1),
    ]);
    const throughMonth = through?.month ?? null;
    if (!last || throughMonth === null) return emptyResult(person_, congress);

    const chambers = [...new Set(countRows.map((r) => r.chamber))].sort();
    const counts = new Map<string, AttendanceCounts>();
    for (const row of countRows) {
      const c = counts.get(row.month) ?? { eligible: 0, missed: 0, present: 0, voted: 0 };
      c.eligible += row.eligible;
      c.missed += row.missed;
      c.present += row.present;
      c.voted += row.voted;
      counts.set(row.month, c);
    }
    const held = new Map<string, number>();
    for (const row of heldRows) {
      if (chambers.length > 0 && !chambers.includes(row.chamber)) continue;
      held.set(row.month, (held.get(row.month) ?? 0) + row.held);
    }
    const months = buildMonths({
      months: monthsBetween(congress, throughMonth),
      counts,
      held,
      terms: termRows,
    });
    const totals = months.reduce(
      (t, m) => ({
        eligible: t.eligible + m.eligible,
        missed: t.missed + m.missed,
        present: t.present + m.present,
        voted: t.voted + m.voted,
      }),
      { eligible: 0, missed: 0, present: 0, voted: 0 },
    );
    return {
      person: person_,
      congress,
      chambers,
      throughMonth,
      months,
      totals: {
        ...totals,
        missedRate: totals.eligible > 0 ? totals.missed / totals.eligible : null,
      },
      definition: DEFINITION,
      provenance: latest ? withProvenance(latest).provenance : null,
    };
  },
});

function emptyResult(who: { slug: string; fullName: string }, congress: number | null) {
  return {
    person: who,
    congress,
    chambers: [],
    throughMonth: null,
    months: [],
    totals: { eligible: 0, missed: 0, present: 0, voted: 0, missedRate: null },
    definition: DEFINITION,
    provenance: null,
  };
}
