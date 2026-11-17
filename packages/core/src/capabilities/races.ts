import {
  candidate,
  candidateCycleTotals,
  type Db,
  independentExpenditure,
  office,
  person,
  term,
} from '@civic-ledger/db';
import { and, desc, eq, inArray, max, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { fecCandidateUrl, INCUMBENCY_LABELS, partyName, STATUS_LABELS } from '../races/fec-codes';
import { formatFecName } from '../races/name';
import { REGISTRATION_NOTICE } from '../races/notice';
import { type FiledRow, placeRow, SINGLE_SEAT_STATES } from '../races/placement';
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

const EvenCycleSchema = CycleSchema.refine((c) => c % 2 === 0, 'An election cycle is an even year');

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

const NoticeSchema = z
  .string()
  .describe('Constant caveat: registration is not a ballot. Show it with these figures.');

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
    'congress-legislators terms: incumbents, seats that exist and whether the seat is up',
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
 * Keys of the seats that exist in `cycle`: some member's term at the seat overlaps the
 * Congress that ends in the cycle (it ends after January 3 of the cycle's first year or
 * has no end), which covers sitting members, vacated seats and delegates. Registrations
 * for any other district (UT-71, GA-23) belong to no seat (DECISIONS A93).
 */
async function loadExistingSeats(db: Db, cycle: number): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ chamber: office.chamber, state: office.state, district: office.district })
    .from(term)
    .innerJoin(office, eq(office.id, term.officeId))
    .where(
      and(
        eq(office.level, 'federal'),
        sql`${term.startDate} <= ${seatUpOn(cycle)}::date`,
        sql`(${term.endDate} is null or ${term.endDate} > ${`${cycle - 1}-01-03`}::date)`,
      ),
    );
  return new Set(rows.map((r) => seatKey(r)));
}

/**
 * Current members whose seat is up in `cycle`: their term (today inside it) ends from
 * November 1 of the cycle through January 3 of the next year. That is January 3 for every
 * regular term, and the November election day for an appointed senator whose term runs
 * until a special election (congress-legislators lists Ohio and Florida's that way in 2026).
 * A term with no scheduled end uses the constitutional length from its start (House 2
 * years, Senate 6), which only the development seed relies on: congress-legislators
 * always gives an end date. "Current" is evaluated at query time, so an appointed senator
 * leaves the list after the November date even if the winner is not yet sworn in.
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

const filed = (r: { office: string; state: string; district: number | null }): FiledRow => r;

/**
 * Seats a member is in for `cycle`: registered there (a candidate row matched to the
 * person) or sitting there with the seat up. Used by profiles to link to their race.
 */
async function seatsOfPerson(db: Db, slug: string, cycle: number, existing: Set<string>) {
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
  const keys = new Set<string>();
  const states = new Set<string>();
  for (const r of registered) {
    const placed = placeRow(filed(r), existing);
    if (placed.seat) keys.add(placed.seatKey);
    states.add(r.state);
  }
  for (const i of sitting.filter((i) => i.slug === slug)) {
    keys.add(seatKey(i));
    states.add(i.state);
  }
  return { keys, states: [...states] };
}

const incumbentRef = (i: Incumbent) => ({
  slug: i.slug,
  fullName: i.fullName,
  party: i.party,
  termEnd: i.termEnd,
});

const sourcesFor = async (db: Db, cycle: number): Promise<RaceSources> => {
  const [candidates, moneyReports, outsideSpending, terms] = await Promise.all([
    latestProvenance(
      db,
      candidate,
      and(eq(candidate.cycle, cycle), eq(candidate.electionYear, cycle)),
    ),
    latestProvenance(db, candidateCycleTotals, eq(candidateCycleTotals.cycle, cycle)),
    latestProvenance(db, independentExpenditure, eq(independentExpenditure.cycle, cycle)),
    latestProvenance(db, term, undefined),
  ]);
  return { candidates, moneyReports, outsideSpending, terms };
};

const PartySummarySchema = z.object({
  code: z.string().nullable().describe('CAND_PTY_AFFILIATION as filed'),
  name: z.string().nullable().describe('Name of a well-known code; null = show the code'),
});

/** Name to show: the person when matched, else the FEC name in reading order; null = none filed. */
function displayNameOf(personName: string | null, nameAsFiled: string | null): string | null {
  if (personName) return personName;
  if (nameAsFiled === null) return null;
  return formatFecName(nameAsFiled) || nameAsFiled;
}

// races.list@1 -------------------------------------------------------------------------

export const RacesListInput = z.strictObject({
  cycle: EvenCycleSchema.optional().describe(
    'Election year (even). Default: the latest cycle with FEC candidate registrations',
  ),
  chamber: ChamberSchema.optional(),
  state: StateCodeSchema.optional(),
  person: SlugSchema.optional().describe(
    'Only seats this member is in: registered there (matched FEC id) or sitting there with the seat up',
  ),
});

const UnplacedSchema = z.object({
  chamber: ChamberSchema,
  state: StateCodeSchema,
  districtAsFiled: z
    .int()
    .min(0)
    .nullable()
    .describe('District exactly as the FEC filed it; null = blank (or a Senate row)'),
  registrations: z.int().min(1),
  candidates: z.array(
    z.object({
      fecCandidateId: z.string(),
      fecUrl: z.url(),
      displayName: z.string().nullable(),
      nameAsFiled: z.string().nullable(),
      party: PartySummarySchema,
    }),
  ),
});

export const RacesListOutput = z.object({
  cycle: CycleSchema,
  notice: NoticeSchema,
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
    .describe(
      'Seats that exist, ordered by state, Senate before House, then district. Never ranked by money.',
    ),
  unplaced: z
    .array(UnplacedSchema)
    .describe(
      'Registrations that belong to no seat: a district that does not exist (UT-71), a blank or "00" district in a state with several, or a Senate row in a place with no senators. Shown as filed.',
    ),
  totals: z.object({
    seats: z.int().min(0),
    seatsUp: z.int().min(0),
    seatsWithoutRegistrations: z.int().min(0),
    registrations: z.int().min(0).describe('Registrations at seats that exist'),
    unplacedRegistrations: z.int().min(0).describe('Registrations that match no seat'),
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
  summary: `Seats in an election cycle with FEC registration counts and the sitting member, by state and chamber. Ordered by seat, never by money. ${REGISTRATION_NOTICE}`,
  input: RacesListInput,
  output: RacesListOutput,
  async handler({ db }, input) {
    const cycle = await resolveCycle(db, input.cycle);
    const officeFilter = input.chamber ? officeCode(input.chamber) : undefined;
    const existing = await loadExistingSeats(db, cycle);
    const mine = input.person ? await seatsOfPerson(db, input.person, cycle, existing) : null;
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
      const existingEntry = seats.get(key);
      if (existingEntry) return existingEntry;
      const created = { seat, incumbents: [], registrations: 0, active: 0, withMoney: 0 };
      seats.set(key, created);
      return created;
    };
    const unplacedGroups = new Map<
      string,
      { chamber: Chamber; state: string; districtAsFiled: number | null; registrations: number }
    >();
    for (const row of counts) {
      const placed = placeRow(filed(row), existing);
      if (placed.seat) {
        const e = entry(placed.seat);
        e.registrations += row.registrations;
        e.active += row.active;
        e.withMoney += row.withMoney;
      } else {
        const key = `${placed.chamber}|${placed.state}|${placed.districtAsFiled ?? ''}`;
        const g = unplacedGroups.get(key) ?? {
          chamber: placed.chamber,
          state: placed.state,
          districtAsFiled: placed.districtAsFiled,
          registrations: 0,
        };
        g.registrations += row.registrations;
        unplacedGroups.set(key, g);
      }
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

    const unplaced =
      mine === null ? await loadUnplaced(db, cycle, [...unplacedGroups.values()]) : [];

    const sum = (pick: (i: (typeof items)[number]) => number) =>
      items.reduce((n, i) => n + pick(i), 0);
    const registrations = sum((i) => i.registrations);
    const withMoney = sum((i) => i.candidatesWithMoneyReports);
    return {
      cycle,
      notice: REGISTRATION_NOTICE,
      seatsUpOn: seatUpOn(cycle),
      items,
      unplaced,
      totals: {
        seats: items.length,
        seatsUp: items.filter((i) => i.seatUp).length,
        seatsWithoutRegistrations: items.filter((i) => i.registrations === 0).length,
        registrations,
        unplacedRegistrations: unplaced.reduce((n, u) => n + u.registrations, 0),
        activeCandidates: sum((i) => i.activeCandidates),
        candidatesWithMoneyReports: withMoney,
        candidatesWithoutMoneyReports: registrations - withMoney,
      },
      sources,
    };
  },
});

/** The registrations behind each unplaced group, named as filed (no seat page exists). */
async function loadUnplaced(
  db: Db,
  cycle: number,
  groups: {
    chamber: Chamber;
    state: string;
    districtAsFiled: number | null;
    registrations: number;
  }[],
) {
  if (groups.length === 0) return [];
  const rows = await db
    .select({
      fecCandidateId: candidate.fecCandidateId,
      nameAsFiled: candidate.nameAsFiled,
      partyCode: candidate.partyCode,
      office: candidate.office,
      state: candidate.state,
      district: candidate.district,
      personName: person.fullName,
    })
    .from(candidate)
    .leftJoin(person, eq(person.id, candidate.personId))
    .where(
      and(
        eq(candidate.cycle, cycle),
        eq(candidate.electionYear, cycle),
        inArray(candidate.state, [...new Set(groups.map((g) => g.state))]),
      ),
    )
    .orderBy(candidate.nameAsFiled, candidate.fecCandidateId);
  return groups
    .map((g) => ({
      ...g,
      candidates: rows
        .filter(
          (r) =>
            OFFICE_CHAMBER[r.office as 'H' | 'S'] === g.chamber &&
            r.state === g.state &&
            (g.chamber === 'senate' ||
              (SINGLE_SEAT_STATES.has(g.state)
                ? true
                : (r.district ?? null) === g.districtAsFiled)),
        )
        .map((r) => ({
          fecCandidateId: r.fecCandidateId,
          fecUrl: fecCandidateUrl(r.fecCandidateId),
          displayName: displayNameOf(r.personName, r.nameAsFiled),
          nameAsFiled: r.nameAsFiled,
          party: { code: r.partyCode, name: partyName(r.partyCode) },
        })),
    }))
    .sort(
      (a, b) =>
        compareSeats(
          { chamber: a.chamber, state: a.state, district: a.districtAsFiled },
          { chamber: b.chamber, state: b.state, district: b.districtAsFiled },
        ) || 0,
    );
}

// races.get@1 --------------------------------------------------------------------------

export const RACE_SORTS = ['name', 'receipts'] as const;

export const RacesGetInput = z.strictObject({
  seat: SeatKeySchema,
  cycle: EvenCycleSchema.optional().describe(
    'Election year (even). Default: the latest cycle with FEC candidate registrations',
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

const AlsoRegisteredSchema = z.object({
  fecCandidateId: z.string(),
  seat: SeatKeySchema.nullable().describe('Seat key of the other registration; null = no seat'),
  chamber: ChamberSchema,
  state: StateCodeSchema,
  sameCommittee: z.boolean().describe('Both registrations name the same principal committee'),
});

export const RacesGetOutput = z.object({
  cycle: CycleSchema,
  notice: NoticeSchema,
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
        .nullable()
        .describe(
          'Person name when matched; otherwise the FEC name in reading order and case; null when the FEC row has no name',
        ),
      nameAsFiled: z.string().nullable().describe('CAND_NAME exactly as the FEC lists it'),
      person: z
        .object({ slug: SlugSchema, fullName: z.string() })
        .nullable()
        .describe('Matched member record (Bioguide); null = not matched, never created'),
      party: PartySummarySchema,
      incumbency: z.string().nullable().describe('CAND_ICI: I, C or O; null when blank'),
      incumbencyLabel: z.string().nullable().describe('Incumbent / Challenger / Open seat'),
      status: z.string().nullable().describe('CAND_STATUS: C, F, N or P; null when blank'),
      statusLabel: z.string().nullable(),
      principalCommitteeId: z.string().nullable(),
      registration: ProvenanceSchema.describe('This candidate registration (cn row)'),
      money: CandidateMoneySchema.nullable().describe('null = no money report on file'),
      outsideSpending: z.object({
        supportCents: CentsSchema,
        opposeCents: CentsSchema,
        expenditures: z.int().min(0),
      }),
      alsoRegisteredFor: z
        .array(AlsoRegisteredSchema)
        .describe(
          'Other registrations this cycle for the same person or the same principal committee',
        ),
      sharedCommitteeWith: z
        .array(z.string())
        .describe(
          'FEC ids with the same principal committee; the FEC repeats one committee’s totals under each, so the figures are not separate campaigns',
        ),
      sameNameAsFiledAs: z
        .array(z.string())
        .describe('Other registrations in this race with the identical name as filed'),
    }),
  ),
  sources: RaceSourcesSchema,
});

export const racesGet = defineCapability({
  name: 'races.get',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: `One seat in an election cycle: every FEC-registered candidate with money as filed and outside support / oppose. Alphabetical unless the caller asks for receipts. ${REGISTRATION_NOTICE}`,
  input: RacesGetInput,
  output: RacesGetOutput,
  async handler({ db }, input) {
    const seat = parseSeatKey(input.seat);
    if (!seat) throw notFound(`No seat "${input.seat}"`);
    const cycle = await resolveCycle(db, input.cycle);
    const code = officeCode(seat.chamber);
    const existing = await loadExistingSeats(db, cycle);
    const key = seatKey(seat);

    // Rows filed in a single-seat state belong to its at-large seat whatever district was
    // typed; elsewhere the district must match exactly.
    const districtMatch =
      seat.chamber === 'senate' || SINGLE_SEAT_STATES.has(seat.state)
        ? undefined
        : sql`${candidate.district} = ${seat.district}`;

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
          personId: candidate.personId,
          slug: person.slug,
          fullName: person.fullName,
          regSourceId: candidate.sourceId,
          regSourceKey: candidate.sourceKey,
          regRunId: candidate.ingestRunId,
          regRetrievedAt: candidate.retrievedAt,
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
            districtMatch,
          ),
        ),
      loadIncumbents(db, cycle, { chamber: seat.chamber, state: seat.state }),
      sourcesFor(db, cycle),
    ]);
    const seatIncumbents = incumbents.filter(
      (i) => seat.chamber === 'senate' || i.district === seat.district,
    );
    // A seat is real when it exists (a current or apportioned office) or someone sits there.
    if (!existing.has(key) && seatIncumbents.length === 0) {
      throw notFound(`No seat "${input.seat}" in ${cycle}`);
    }

    const personIds = [...new Set(rows.flatMap((r) => (r.personId === null ? [] : [r.personId])))];
    const committees = [
      ...new Set(rows.flatMap((r) => (r.principalCommitteeId ? [r.principalCommitteeId] : []))),
    ];
    const [outside, related] = await Promise.all([
      loadOutsideTotalsByFecId(
        db,
        rows.map((r) => r.fecCandidateId),
        cycle,
      ),
      personIds.length === 0 && committees.length === 0
        ? Promise.resolve([])
        : db
            .select({
              fecCandidateId: candidate.fecCandidateId,
              personId: candidate.personId,
              principalCommitteeId: candidate.principalCommitteeId,
              office: candidate.office,
              state: candidate.state,
              district: candidate.district,
            })
            .from(candidate)
            .where(
              and(
                eq(candidate.cycle, cycle),
                eq(candidate.electionYear, cycle),
                or(
                  personIds.length > 0 ? inArray(candidate.personId, personIds) : undefined,
                  committees.length > 0
                    ? inArray(candidate.principalCommitteeId, committees)
                    : undefined,
                ),
              ),
            ),
    ]);

    const candidates = rows.map((r) => {
      const totals = outside.get(r.fecCandidateId);
      const others = related.filter(
        (o) =>
          o.fecCandidateId !== r.fecCandidateId &&
          ((r.personId !== null && o.personId === r.personId) ||
            (r.principalCommitteeId !== null && o.principalCommitteeId === r.principalCommitteeId)),
      );
      return {
        fecCandidateId: r.fecCandidateId,
        fecUrl: fecCandidateUrl(r.fecCandidateId),
        displayName: displayNameOf(r.fullName, r.nameAsFiled),
        nameAsFiled: r.nameAsFiled,
        person: r.slug && r.fullName ? { slug: r.slug, fullName: r.fullName } : null,
        party: { code: r.partyCode, name: partyName(r.partyCode) },
        incumbency: r.incumbency,
        incumbencyLabel: r.incumbency ? (INCUMBENCY_LABELS[r.incumbency] ?? null) : null,
        status: r.status,
        statusLabel: r.status ? (STATUS_LABELS[r.status] ?? null) : null,
        principalCommitteeId: r.principalCommitteeId,
        registration: withProvenance({
          sourceId: r.regSourceId,
          sourceKey: r.regSourceKey,
          ingestRunId: r.regRunId,
          retrievedAt: r.regRetrievedAt,
        }).provenance,
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
        alsoRegisteredFor: others
          .map((o) => {
            const placed = placeRow(filed(o), existing);
            return {
              fecCandidateId: o.fecCandidateId,
              seat: placed.seat ? placed.seatKey : null,
              chamber: OFFICE_CHAMBER[o.office as 'H' | 'S'] ?? ('house' as const),
              state: o.state,
              sameCommittee:
                r.principalCommitteeId !== null &&
                o.principalCommitteeId === r.principalCommitteeId,
            };
          })
          .sort((a, b) => a.fecCandidateId.localeCompare(b.fecCandidateId)),
        sharedCommitteeWith: others
          .filter(
            (o) =>
              r.principalCommitteeId !== null && o.principalCommitteeId === r.principalCommitteeId,
          )
          .map((o) => o.fecCandidateId)
          .sort(),
        sameNameAsFiledAs: rows
          .filter(
            (o) =>
              o.fecCandidateId !== r.fecCandidateId &&
              r.nameAsFiled !== null &&
              o.nameAsFiled === r.nameAsFiled,
          )
          .map((o) => o.fecCandidateId)
          .sort(),
      };
    });

    // A missing name sorts last; ties fall back to the FEC id.
    const byName = (a: (typeof candidates)[number], b: (typeof candidates)[number]) => {
      if ((a.nameAsFiled === null) !== (b.nameAsFiled === null))
        return a.nameAsFiled === null ? 1 : -1;
      return (
        (a.nameAsFiled ?? '').localeCompare(b.nameAsFiled ?? '', 'en') ||
        a.fecCandidateId.localeCompare(b.fecCandidateId)
      );
    };
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
      notice: REGISTRATION_NOTICE,
      seat: { key, ...seat },
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
