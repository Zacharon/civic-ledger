import { personCard, term } from '@civic-ledger/db';
import { and, desc, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import {
  ChamberSchema,
  EmptyInputSchema,
  IsoDateSchema,
  PartySchema,
  ProvenanceSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';
import { isCurrentMember } from './person-card';

/** Voting seats fixed by law: 435 in the House (2 U.S.C. 2a), 2 per state in the Senate. */
export const CHAMBER_SEATS = { house: 435, senate: 100 } as const;

/**
 * House members who do not vote on the floor: the delegates of the District of Columbia,
 * American Samoa, Guam, the Northern Mariana Islands and the U.S. Virgin Islands, and
 * Puerto Rico's Resident Commissioner. They are counted apart from the 435 voting seats.
 */
export const NON_VOTING_JURISDICTIONS = ['AS', 'DC', 'GU', 'MP', 'PR', 'VI'] as const;

/**
 * Vacancies are only derived when the roster on file looks complete: at least this share
 * of the voting seats must be filled. A far smaller roster is a partial load (for example
 * a sample database), and calling the difference "vacant seats" would be wrong.
 */
export const VACANCY_MIN_FILLED_SHARE = 0.9;

const PARTY_RANK = [
  /^democrat(ic)?( party)?$/i,
  /^independent$/i,
  /^republican( party)?$/i,
] as const;

/**
 * The seat-chart order, a neutral rule and not a political one: Democrat, Independent,
 * Republican (alphabetical among themselves), then every other party alphabetically by
 * name. Never by size, never by ideology.
 */
export function compareSeatParties(a: string, b: string): number {
  const rank = (name: string) => {
    const i = PARTY_RANK.findIndex((re) => re.test(name.trim()));
    return i === -1 ? PARTY_RANK.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b, 'en');
}

const PartyCountSchema = z.object({ party: PartySchema, count: z.int().min(1) });

const ChamberBlockSchema = z.object({
  chamber: ChamberSchema,
  seats: z.int().describe('Voting seats fixed by law'),
  members: z.int().min(0).describe('Voting members currently serving on file'),
  voting: z.array(PartyCountSchema).describe('Voting members by party, in the documented order'),
  nonVoting: z
    .object({
      total: z.int().min(0),
      parties: z.array(PartyCountSchema),
      jurisdictions: z.array(z.string()).describe('Two-letter codes, alphabetical'),
    })
    .describe('Delegates and the Resident Commissioner (House only), outside the voting seats'),
  vacancies: z
    .int()
    .min(0)
    .nullable()
    .describe('seats - members; null when the roster on file looks like a partial load'),
});

export const ChamberCompositionOutput = z.object({
  asOf: IsoDateSchema.describe('The day "currently serving" was evaluated'),
  partyOrder: z.string().describe('How parties are ordered in every list'),
  chambers: z.array(ChamberBlockSchema),
  provenance: ProvenanceSchema.nullable().describe(
    'Most recently loaded term among current members; null when nobody is serving',
  ),
  definition: z.string(),
});

const PARTY_ORDER_RULE =
  'Democrat, Independent, Republican (alphabetical among themselves), then every other party alphabetically by name. Not by size or ideology.';

const DEFINITION =
  'Current members are those whose latest term covers the as-of date, by the party on that term. Delegates and the Resident Commissioner are counted separately from the 435 voting House seats. Vacancies are seats minus voting members, shown only when the roster on file is near complete.';

export const chamberComposition = defineCapability({
  name: 'chamber.composition',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Current House and Senate composition by party: voting members, non-voting delegates counted apart, and vacancies when derivable.',
  input: EmptyInputSchema,
  output: ChamberCompositionOutput,
  async handler({ db }) {
    const [rows, [day], [latest]] = await Promise.all([
      db
        .select({
          chamber: personCard.chamber,
          state: personCard.state,
          party: personCard.party,
          count: sql<number>`count(*)::int`,
        })
        .from(personCard)
        .where(isCurrentMember)
        .groupBy(personCard.chamber, personCard.state, personCard.party),
      db.select({ today: sql<string>`current_date::text` }).from(sql`(select 1) as one`),
      db
        .select(provenanceFields(term))
        .from(term)
        .where(
          and(
            lte(term.startDate, sql`current_date`),
            or(isNull(term.endDate), gt(term.endDate, sql`current_date`)),
          ),
        )
        .orderBy(desc(term.retrievedAt), desc(term.id))
        .limit(1),
    ]);

    const isNonVoting = (chamber: string | null, state: string | null) =>
      chamber === 'house' &&
      state !== null &&
      (NON_VOTING_JURISDICTIONS as readonly string[]).includes(state);

    const chambers = (['house', 'senate'] as const).map((chamber) => {
      const voting = new Map<string, number>();
      const nonVoting = new Map<string, number>();
      const jurisdictions = new Set<string>();
      for (const row of rows) {
        if (row.chamber !== chamber || row.party === null) continue;
        if (isNonVoting(row.chamber, row.state)) {
          nonVoting.set(row.party, (nonVoting.get(row.party) ?? 0) + row.count);
          if (row.state) jurisdictions.add(row.state);
        } else voting.set(row.party, (voting.get(row.party) ?? 0) + row.count);
      }
      const list = (m: Map<string, number>) =>
        [...m.entries()]
          .sort(([a], [b]) => compareSeatParties(a, b))
          .map(([party, count]) => ({ party, count }));
      const seats = CHAMBER_SEATS[chamber];
      const members = [...voting.values()].reduce((a, b) => a + b, 0);
      const nonVotingParties = list(nonVoting);
      return {
        chamber,
        seats,
        members,
        voting: list(voting),
        nonVoting: {
          total: nonVotingParties.reduce((a, p) => a + p.count, 0),
          parties: nonVotingParties,
          jurisdictions: [...jurisdictions].sort(),
        },
        vacancies:
          members >= seats * VACANCY_MIN_FILLED_SHARE ? Math.max(seats - members, 0) : null,
      };
    });

    return {
      asOf: day?.today ?? new Date().toISOString().slice(0, 10),
      partyOrder: PARTY_ORDER_RULE,
      chambers,
      provenance: latest ? withProvenance(latest).provenance : null,
      definition: DEFINITION,
    };
  },
});
