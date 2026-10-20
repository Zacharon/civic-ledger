import {
  candidate,
  candidateCycleTotals,
  type Db,
  independentExpenditure,
  office,
  person,
  term,
} from '@civic-ledger/db';
import { and, desc, eq, inArray, max, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { fecCandidateUrl, INCUMBENCY_LABELS, partyName, STATUS_LABELS } from '../races/fec-codes';
import { formatFecName } from '../races/name';
import { compareSeats, parseSeatKey, type Seat, SeatKeySchema, seatKey } from '../races/seat';
import {
  CentsSchema,
  ChamberSchema,
  CycleSchema,
  IsoDateSchema,
  PartySchema,
  ProvenanceSchema,
  SlugSchema,
  StateCodeSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';
import { loadOutsideTotalsByFecId } from './outside-spending';

// Shared pieces -----------------------------------------------------------------------

const SeatSchema = z.object({
  key: SeatKeySchema.describe('Stable seat key: ga-senate, ga-10, ak-al (at-large House seat)'),
  chamber: ChamberSchema,
  state: StateCodeSchema,
  district: z.int().min(0).nullable().describe('House district; 0 = at-large; null for the Senate'),
});

const IncumbentSchema = z.object({
  slug: SlugSchema,
  fullName: z.string(),
  party: PartySchema.describe('Party of the current term, from congress-legislators'),
  termEnd: IsoDateSchema.describe(
    'End of the current term: January 3 of the next year, or the election day for an appointed senator',
  ),
});

/** Provenance of the newest row of each source behind a race figure; null = no such rows. */
const RaceSourcesSchema = z.object({
  candidates: ProvenanceSchema.nullable().describe(
    'FEC candidate master (cn): registrations and their FEC codes',
  ),
  moneyReports: ProvenanceSchema.nullable().describe(
    'FEC all-candidates summary (weball): receipts, cash on hand, coverage end',
  ),
  outsideSpending: ProvenanceSchema.nullable().describe('FEC independent expenditures'),
  terms: ProvenanceSchema.nullable().describe(
    'congress-legislators terms: incumbents and whether the seat is up',
  ),
});
type RaceSources = z.infer<typeof RaceSourcesSchema>;

const seatUpOn = (cycle: number) => `${cycle + 1}-01-03`;

const OFFICE_CHAMBER = { H: 'house', S: 'senate' } as const;

type Chamber = 'house' | 'senate';
const officeCode = (chamber: Chamber) => (chamber === 'house' ? 'H' : 'S');

interface Incumbent {
  slug: string;
  fullName: string;
  party: string;
  termEnd: string;
  chamber: Chamber;
  state: string;
  district: number | null;
}

/** Newest row's provenance for one source table (all rows of a source/cycle share one run). */
async function latestProvenance<
  T extends PgTable & {
    id: AnyPgColumn;
    sourceId: AnyPgColumn;
    sourceKey: AnyPgColumn;
    ingestRunId: AnyPgColumn;
    retrievedAt: AnyPgColumn;
  },
>(db: Db, table: T, where: SQL | undefined) {
  const [row] = await db
    .select(provenanceFields(table as never) as never)
    .from(table as PgTable)
    .where(where)
    .orderBy(desc(table.retrievedAt), desc(table.id))
    .limit(1);
  return row
    ? (withProvenance(row as never) as { provenance: z.infer<typeof ProvenanceSchema> }).provenance
    : null;
}

/** The latest cycle with candidate rows, or the cycle that is current by the calendar. */
async function resolveCycle(db: Db, requested: number | undefined): Promise<number> {
  if (requested !== undefined) return requested;
  const [row] = await db.select({ cycle: max(candidate.cycle) }).from(candidate);
  if (row?.cycle != null) return row.cycle;
  const year = new Date().getUTCFullYear();
  return year % 2 === 0 ? year : year + 1;
}

/**
 * Current members whose seat is up in `cycle`: their term (today inside it) ends from
 * November 1 of the cycle through January 3 of the next year. That is January 3 for every
 * regular term, and the November election day for an appointed senator whose term runs
 * until a special election (congress-legislators lists Ohio and Florida's that way in 2026).
 * A term with no scheduled end uses the constitutional length from its start (House 2
 * years, Senate 6), which only the development seed relies on: congress-legislators
 * always gives an end date.
 */
async function loadIncumbents(
  db: Db,
  cycle: number,
  filter: { chamber?: Chamber; state?: string; district?: number | null },
): Promise<Incumbent[]> {
  const scheduledEnd = sql<string>`to_char(coalesce(${term.endDate}, (${term.startDate} + case when ${office.chamber} = 'house' then interval '2 years' else interval '6 years' end)::date), 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      slug: person.slug,
      fullName: person.fullName,
      party: term.party,
      chamber: office.chamber,
      state: office.state,
      district: office.district,
      scheduledEnd,
    })
    .from(term)
    .innerJoin(office, eq(office.id, term.officeId))
    .innerJoin(person, eq(person.id, term.personId))
    .where(
      and(
        eq(office.level, 'federal'),
        sql`${term.startDate} <= current_date`,
        sql`(${term.endDate} is null or ${term.endDate} > current_date)`,
        filter.chamber ? eq(office.chamber, filter.chamber) : undefined,
        filter.state ? eq(office.state, filter.state) : undefined,
        filter.district === undefined
          ? undefined
          : sql`${office.district} is not distinct from ${filter.district}`,
      ),
    );
  const [from, to] = [`${cycle}-11-01`, seatUpOn(cycle)];
  return rows
    .filter((r) => r.scheduledEnd >= from && r.scheduledEnd <= to)
    .map(({ scheduledEnd, ...r }) => ({ ...r, termEnd: scheduledEnd }))
    .sort(
      (a, b) =>
        compareSeats(a, b) || a.fullName.localeCompare(b.fullName) || a.slug.localeCompare(b.slug),
    );
}

/**
 * Seats a member is in for `cycle`: registered there (a candidate row matched to the
 * person) or sitting there with the seat up. Used by profiles to link to their race.
 */
async function seatsOfPerson(db: Db, slug: string, cycle: number) {
  const [who] = await db.select({ id: person.id }).from(person).where(eq(person.slug, slug));
  if (!who) throw notFound(`No person with slug "${slug}"`);
  const [registered, sitting] = await Promise.all([
    db
      .selectDistinct({
        office: candidate.office,
        state: candidate.state,
        district: candidate.district,
      })
      .from(candidate)
      .where(
        and(
          eq(candidate.cycle, cycle),
          eq(candidate.electionYear, cycle),
          eq(candidate.personId, who.id),
        ),
      ),
    loadIncumbents(db, cycle, {}),
  ]);
  const seats: Seat[] = [
    ...registered.flatMap((r) => {
      const chamber = OFFICE_CHAMBER[r.office as 'H' | 'S'];
      return chamber
        ? [{ chamber, state: r.state, district: chamber === 'senate' ? null : (r.district ?? 0) }]
        : [];
    }),
    ...sitting.filter((i) => i.slug === slug),
  ];
  return {
    keys: new Set(seats.map(seatKey)),
    states: [...new Set(seats.map((s) => s.state))],
  };
}

const incumbentRef = (i: Incumbent) => ({
  slug: i.slug,
  fullName: i.fullName,
  party: i.party,
  termEnd: i.termEnd,
});

const sourcesFor = async (db: Db, cycle: number, seat?: Seat): Promise<RaceSources> => {
  const candidateWhere = and(
    eq(candidate.cycle, cycle),
    eq(candidate.electionYear, cycle),
    seat ? eq(candidate.office, officeCode(seat.chamber)) : undefined,
    seat ? eq(candidate.state, seat.state) : undefined,
    seat ? sql`${candidate.district} is not distinct from ${seat.district}` : undefined,
  );
  const [candidates, moneyReports, outsideSpending, terms] = await Promise.all([
    latestProvenance(db, candidate, candidateWhere),
    latestProvenance(db, candidateCycleTotals, eq(candidateCycleTotals.cycle, cycle)),
    latestProvenance(db, independentExpenditure, eq(independentExpenditure.cycle, cycle)),
    latestProvenance(db, term, undefined),
  ]);
  return { candidates, moneyReports, outsideSpending, terms };
};

// races.list@1 -------------------------------------------------------------------------

export const RacesListInput = z.strictObject({
  cycle: CycleSchema.optional().describe(
    'Election year (even). Default: the latest cycle with FEC candidate registrations',
  ),
  chamber: ChamberSchema.optional(),
  state: StateCodeSchema.optional(),
  person: SlugSchema.optional().describe(
    'Only seats this member is in: registered there (matched FEC id) or sitting there with the seat up',
  ),
});

export const RacesListOutput = z.object({
  cycle: CycleSchema,
  seatsUpOn: IsoDateSchema.describe(
    'January 3 of the next year, when regular terms for the cycle end. An appointed senator whose term runs to the November special election is up too (see incumbents[].termEnd)',
  ),
  items: z
    .array(
      z.object({
        seat: SeatSchema,
        seatUp: z
          .boolean()
          .describe(
            'A current member term for this seat ends on `seatsUpOn` or at the November election (congress-legislators)',
          ),
        incumbents: z
          .array(IncumbentSchema)
          .describe('Current members whose term ends on `seatsUpOn`; empty for an open seat'),
        registrations: z
          .int()
          .min(0)
          .describe('FEC candidate registrations for this seat and cycle'),
        activeCandidates: z.int().min(0).describe('Registrations with FEC status C'),
        candidatesWithMoneyReports: z
          .int()
          .min(0)
          .describe('Registrations with a campaign money report in the FEC all-candidates file'),
      }),
    )
    .describe('Seats ordered by state, Senate before House, then district. Never ranked by money.'),
  totals: z.object({
    seats: z.int().min(0),
    seatsUp: z.int().min(0),
    seatsWithoutRegistrations: z.int().min(0),
    registrations: z.int().min(0),
    activeCandidates: z.int().min(0),
    candidatesWithMoneyReports: z.int().min(0),
    candidatesWithoutMoneyReports: z.int().min(0),
  }),
  sources: RaceSourcesSchema,
});

export const racesList = defineCapability({
  name: 'races.list',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Seats in an election cycle with FEC registration counts and the sitting member, by state and chamber. Ordered by seat, never by money.',
  input: RacesListInput,
  output: RacesListOutput,
  async handler({ db }, input) {
    const cycle = await resolveCycle(db, input.cycle);
    const officeFilter = input.chamber ? officeCode(input.chamber) : undefined;
    const mine = input.person ? await seatsOfPerson(db, input.person, cycle) : null;
    const [counts, incumbents, sources] = await Promise.all([
      db
        .select({
          office: candidate.office,
          state: candidate.state,
          district: candidate.district,
          registrations: sql<number>`count(*)::int`.mapWith(Number),
          active: sql<number>`(count(*) filter (where ${candidate.status} = 'C'))::int`.mapWith(
            Number,
          ),
          withMoney: sql<number>`count(${candidateCycleTotals.id})::int`.mapWith(Number),
        })
        .from(candidate)
        .leftJoin(
          candidateCycleTotals,
          and(
            eq(candidateCycleTotals.fecCandidateId, candidate.fecCandidateId),
            eq(candidateCycleTotals.cycle, candidate.cycle),
          ),
        )
        .where(
          and(
            eq(candidate.cycle, cycle),
            eq(candidate.electionYear, cycle),
            officeFilter ? eq(candidate.office, officeFilter) : undefined,
            input.state ? eq(candidate.state, input.state) : undefined,
            mine
              ? mine.states.length > 0
                ? inArray(candidate.state, mine.states)
                : sql`false`
              : undefined,
          ),
        )
        .groupBy(candidate.office, candidate.state, candidate.district),
      loadIncumbents(db, cycle, { chamber: input.chamber, state: input.state }),
      sourcesFor(db, cycle),
    ]);

    const seats = new Map<
      string,
      {
        seat: Seat;
        incumbents: Incumbent[];
        registrations: number;
        active: number;
        withMoney: number;
      }
    >();
    const entry = (seat: Seat) => {
      const key = seatKey(seat);
      const existing = seats.get(key);
      if (existing) return existing;
      const created = { seat, incumbents: [], registrations: 0, active: 0, withMoney: 0 };
      seats.set(key, created);
      return created;
    };
    for (const row of counts) {
      const chamber = OFFICE_CHAMBER[row.office as 'H' | 'S'];
      if (!chamber) continue;
      const e = entry({
        chamber,
        state: row.state,
        district: chamber === 'senate' ? null : (row.district ?? 0),
      });
      e.registrations = row.registrations;
      e.active = row.active;
      e.withMoney = row.withMoney;
    }
    for (const i of incumbents) {
      entry({ chamber: i.chamber, state: i.state, district: i.district }).incumbents.push(i);
    }

    const items = [...seats.values()]
      .filter((e) => mine === null || mine.keys.has(seatKey(e.seat)))
      .sort((a, b) => compareSeats(a.seat, b.seat))
      .map((e) => ({
        seat: { key: seatKey(e.seat), ...e.seat },
        seatUp: e.incumbents.length > 0,
        incumbents: e.incumbents.map(incumbentRef),
        registrations: e.registrations,
        activeCandidates: e.active,
        candidatesWithMoneyReports: e.withMoney,
      }));
    const sum = (pick: (i: (typeof items)[number]) => number) =>
      items.reduce((n, i) => n + pick(i), 0);
    const registrations = sum((i) => i.registrations);
    const withMoney = sum((i) => i.candidatesWithMoneyReports);
    return {
      cycle,
      seatsUpOn: seatUpOn(cycle),
      items,
      totals: {
        seats: items.length,
        seatsUp: items.filter((i) => i.seatUp).length,
        seatsWithoutRegistrations: items.filter((i) => i.registrations === 0).length,
        registrations,
        activeCandidates: sum((i) => i.activeCandidates),
        candidatesWithMoneyReports: withMoney,
        candidatesWithoutMoneyReports: registrations - withMoney,
      },
      sources,
    };
  },
});

// races.get@1 --------------------------------------------------------------------------

export const RACE_SORTS = ['name', 'receipts'] as const;

export const RacesGetInput = z.strictObject({
  seat: SeatKeySchema,
  cycle: CycleSchema.optional().describe(
    'Default: the latest cycle with FEC candidate registrations',
  ),
  sort: z
    .enum(RACE_SORTS)
    .default('name')
    .describe(
      'name (default, alphabetical by the name as filed) or receipts (largest first, opt-in; candidates with no report last). Never ordered by money unless asked.',
    ),
});

const CandidateMoneySchema = z.object({
  totalReceiptsCents: CentsSchema,
  cashOnHandCents: CentsSchema.describe('As filed: can be negative'),
  coverageEndDate: IsoDateSchema.nullable().describe('Last day the report covers'),
  provenance: ProvenanceSchema,
});

export const RacesGetOutput = z.object({
  cycle: CycleSchema,
  seat: SeatSchema,
  seatUp: z
    .boolean()
    .describe(
      'A current member term for this seat ends on `seatsUpOn` or at the November election',
    ),
  seatsUpOn: IsoDateSchema,
  incumbents: z.array(IncumbentSchema),
  senateSeatsUp: z
    .int()
    .min(0)
    .nullable()
    .describe(
      'Senate only: sitting senators of the state whose term ends on `seatsUpOn`. Two means a regular and a special election share this key and candidates cannot be told apart.',
    ),
  sort: z.enum(RACE_SORTS),
  counts: z.object({
    registrations: z.int().min(0),
    activeCandidates: z.int().min(0).describe('FEC status C'),
    withMoneyReports: z.int().min(0),
    withoutMoneyReports: z.int().min(0),
  }),
  candidates: z.array(
    z.object({
      fecCandidateId: z.string(),
      fecUrl: z.url().describe('The candidate on fec.gov'),
      displayName: z
        .string()
        .describe('Person name when matched; otherwise the FEC name in reading order and case'),
      nameAsFiled: z.string().describe('CAND_NAME exactly as the FEC lists it'),
      person: z
        .object({ slug: SlugSchema, fullName: z.string() })
        .nullable()
        .describe('Matched member record (Bioguide); null = not matched, never created'),
      party: z.object({
        code: z.string().nullable().describe('CAND_PTY_AFFILIATION as filed'),
        name: z.string().nullable().describe('Name of a well-known code; null = show the code'),
      }),
      incumbency: z.string().nullable().describe('CAND_ICI: I, C or O; null when blank'),
      incumbencyLabel: z.string().nullable().describe('Incumbent / Challenger / Open seat'),
      status: z.string().nullable().describe('CAND_STATUS: C, F, N or P; null when blank'),
      statusLabel: z.string().nullable(),
      principalCommitteeId: z.string().nullable(),
      money: CandidateMoneySchema.nullable().describe('null = no money report on file'),
      outsideSpending: z.object({
        supportCents: CentsSchema,
        opposeCents: CentsSchema,
        expenditures: z.int().min(0),
      }),
    }),
  ),
  sources: RaceSourcesSchema,
});

export const racesGet = defineCapability({
  name: 'races.get',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'One seat in an election cycle: every FEC-registered candidate with money as filed and outside support / oppose. Alphabetical unless the caller asks for receipts.',
  input: RacesGetInput,
  output: RacesGetOutput,
  async handler({ db }, input) {
    const seat = parseSeatKey(input.seat);
    if (!seat) throw notFound(`No seat "${input.seat}"`);
    const cycle = await resolveCycle(db, input.cycle);
    const code = officeCode(seat.chamber);

    const [rows, incumbents, sources] = await Promise.all([
      db
        .select({
          id: candidate.id,
          fecCandidateId: candidate.fecCandidateId,
          nameAsFiled: candidate.nameAsFiled,
          partyCode: candidate.partyCode,
          incumbency: candidate.incumbency,
          status: candidate.status,
          principalCommitteeId: candidate.principalCommitteeId,
          slug: person.slug,
          fullName: person.fullName,
          receipts: candidateCycleTotals.totalReceiptsCents,
          cashOnHand: candidateCycleTotals.cashOnHandCents,
          coverageEnd: candidateCycleTotals.coverageEndDate,
          moneySourceId: candidateCycleTotals.sourceId,
          moneySourceKey: candidateCycleTotals.sourceKey,
          moneyRunId: candidateCycleTotals.ingestRunId,
          moneyRetrievedAt: candidateCycleTotals.retrievedAt,
          hasMoney: candidateCycleTotals.id,
        })
        .from(candidate)
        .leftJoin(person, eq(person.id, candidate.personId))
        .leftJoin(
          candidateCycleTotals,
          and(
            eq(candidateCycleTotals.fecCandidateId, candidate.fecCandidateId),
            eq(candidateCycleTotals.cycle, candidate.cycle),
          ),
        )
        .where(
          and(
            eq(candidate.cycle, cycle),
            eq(candidate.electionYear, cycle),
            eq(candidate.office, code),
            eq(candidate.state, seat.state),
            sql`${candidate.district} is not distinct from ${seat.district}`,
          ),
        ),
      loadIncumbents(db, cycle, { chamber: seat.chamber, state: seat.state }),
      sourcesFor(db, cycle, seat),
    ]);
    const seatIncumbents = incumbents.filter(
      (i) => seat.chamber === 'senate' || i.district === seat.district,
    );
    if (rows.length === 0 && seatIncumbents.length === 0) {
      throw notFound(`No race for seat "${input.seat}" in ${cycle}`);
    }

    const outside = await loadOutsideTotalsByFecId(
      db,
      rows.map((r) => r.fecCandidateId),
      cycle,
    );
    const candidates = rows.map((r) => {
      const totals = outside.get(r.fecCandidateId);
      return {
        fecCandidateId: r.fecCandidateId,
        fecUrl: fecCandidateUrl(r.fecCandidateId),
        displayName: r.fullName ?? (formatFecName(r.nameAsFiled) || r.nameAsFiled),
        nameAsFiled: r.nameAsFiled,
        person: r.slug && r.fullName ? { slug: r.slug, fullName: r.fullName } : null,
        party: { code: r.partyCode, name: partyName(r.partyCode) },
        incumbency: r.incumbency,
        incumbencyLabel: r.incumbency ? (INCUMBENCY_LABELS[r.incumbency] ?? null) : null,
        status: r.status,
        statusLabel: r.status ? (STATUS_LABELS[r.status] ?? null) : null,
        principalCommitteeId: r.principalCommitteeId,
        money:
          r.hasMoney === null || r.receipts === null || r.cashOnHand === null
            ? null
            : {
                totalReceiptsCents: r.receipts,
                cashOnHandCents: r.cashOnHand,
                coverageEndDate: r.coverageEnd,
                provenance: withProvenance({
                  sourceId: r.moneySourceId ?? '',
                  sourceKey: r.moneySourceKey ?? '',
                  ingestRunId: r.moneyRunId ?? 0,
                  retrievedAt: r.moneyRetrievedAt ?? new Date(0),
                }).provenance,
              },
        outsideSpending: {
          supportCents: totals?.supportCents ?? 0,
          opposeCents: totals?.opposeCents ?? 0,
          expenditures: totals?.expenditures ?? 0,
        },
      };
    });

    const byName = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
      a.nameAsFiled.localeCompare(b.nameAsFiled, 'en') ||
      a.fecCandidateId.localeCompare(b.fecCandidateId);
    candidates.sort((a, b) => {
      if (input.sort === 'receipts') {
        // Opt-in only. A missing report sorts after every report; ties fall back to the name.
        const ar = a.money?.totalReceiptsCents ?? Number.NEGATIVE_INFINITY;
        const br = b.money?.totalReceiptsCents ?? Number.NEGATIVE_INFINITY;
        if (ar !== br) return br > ar ? 1 : -1;
      }
      return byName(a, b);
    });

    const withMoney = candidates.filter((c) => c.money !== null).length;
    return {
      cycle,
      seat: { key: seatKey(seat), ...seat },
      seatUp: seatIncumbents.length > 0,
      seatsUpOn: seatUpOn(cycle),
      incumbents: seatIncumbents.map(incumbentRef),
      senateSeatsUp: seat.chamber === 'senate' ? seatIncumbents.length : null,
      sort: input.sort,
      counts: {
        registrations: candidates.length,
        activeCandidates: candidates.filter((c) => c.status === 'C').length,
        withMoneyReports: withMoney,
        withoutMoneyReports: candidates.length - withMoney,
      },
      candidates,
      sources,
    };
  },
});
