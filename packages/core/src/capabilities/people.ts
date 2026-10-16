import {
  candidacy,
  type Db,
  office,
  person,
  personCard,
  personIdentifier,
  platformPosition,
  policyArea,
  term,
  votePosition,
} from '@civic-ledger/db';
import { and, asc, desc, eq, ilike, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  ChamberSchema,
  CycleSchema,
  IsoDateSchema,
  PageSchema,
  PaginationInput,
  PartySchema,
  PolicyAreaRefSchema,
  ProvenanceSchema,
  ShareSchema,
  SlugSchema,
  StateCodeSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';
import {
  containsPattern,
  countCards,
  findCard,
  PersonCardRowSchema,
  PersonSummarySchema,
  selectCards,
} from './person-card';

// people.search@1 ------------------------------------------------------------

export const PeopleSearchInput = z.strictObject({
  q: z.string().trim().min(1).max(100).optional().describe('Name contains (case-insensitive)'),
  chamber: ChamberSchema.optional(),
  state: StateCodeSchema.optional(),
  party: PartySchema.optional(),
  ...PaginationInput,
});

export const PeopleSearchOutput = z.object({
  items: z.array(PersonSummarySchema),
  ...PageSchema,
});

export const peopleSearch = defineCapability({
  name: 'people.search',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Find officeholders by name, chamber, state or party. Ordered by name.',
  input: PeopleSearchInput,
  output: PeopleSearchOutput,
  async handler({ db }, input) {
    const where = and(
      input.q ? ilike(personCard.fullName, containsPattern(input.q)) : undefined,
      input.chamber ? eq(personCard.chamber, input.chamber) : undefined,
      input.state ? eq(personCard.state, input.state) : undefined,
      input.party ? eq(personCard.party, input.party) : undefined,
    );
    const [items, total] = await Promise.all([
      db
        .select({
          slug: personCard.slug,
          fullName: personCard.fullName,
          party: personCard.party,
          state: personCard.state,
          chamber: personCard.chamber,
          district: personCard.district,
        })
        .from(personCard)
        .where(where)
        .orderBy(asc(personCard.sortName), asc(personCard.personId))
        .limit(input.limit)
        .offset(input.offset),
      countCards(db, where),
    ]);
    return { items, total, limit: input.limit, offset: input.offset };
  },
});

// people.get@1 ---------------------------------------------------------------

const SeatSchema = z.object({
  chamber: ChamberSchema,
  state: StateCodeSchema,
  district: z.int().nullable(),
  party: PartySchema,
});

export const PeopleGetInput = z.strictObject({ slug: SlugSchema });

export const PeopleGetOutput = z.object({
  person: z.object({
    slug: SlugSchema,
    fullName: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    birthDate: IsoDateSchema.nullable(),
    provenance: ProvenanceSchema,
  }),
  card: PersonCardRowSchema,
  identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })),
  terms: z.array(
    SeatSchema.extend({
      startDate: IsoDateSchema,
      endDate: IsoDateSchema.nullable(),
      provenance: ProvenanceSchema,
    }),
  ),
  candidacies: z.array(
    SeatSchema.extend({
      cycle: CycleSchema,
      outcome: z.enum(['won', 'lost', 'withdrew', 'pending']).nullable(),
      fecCandidateId: z.string().nullable(),
      provenance: ProvenanceSchema,
    }),
  ),
  platform: z.array(
    z.object({
      cycle: CycleSchema,
      policyArea: PolicyAreaRefSchema,
      stance: z.string(),
      sourceUrl: z.url(),
      provenance: ProvenanceSchema,
    }),
  ),
});

export const peopleGet = defineCapability({
  name: 'people.get',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Profile header: identity, current card, terms, campaigns and stated platform.',
  input: PeopleGetInput,
  output: PeopleGetOutput,
  async handler({ db }, { slug }) {
    const [row] = await db
      .select({
        id: person.id,
        slug: person.slug,
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        birthDate: person.birthDate,
        ...provenanceFields(person),
      })
      .from(person)
      .where(eq(person.slug, slug))
      .limit(1);
    const card = await findCard(db, slug);
    if (!row || !card) throw notFound(`No person with slug "${slug}"`);

    const seat = {
      chamber: office.chamber,
      state: office.state,
      district: office.district,
    };
    const [identifiers, terms, candidacies, platform] = await Promise.all([
      db
        .select({ scheme: personIdentifier.scheme, value: personIdentifier.value })
        .from(personIdentifier)
        .where(eq(personIdentifier.personId, row.id))
        .orderBy(personIdentifier.scheme),
      db
        .select({
          ...seat,
          party: term.party,
          startDate: term.startDate,
          endDate: term.endDate,
          ...provenanceFields(term),
        })
        .from(term)
        .innerJoin(office, eq(office.id, term.officeId))
        .where(eq(term.personId, row.id))
        .orderBy(desc(term.startDate)),
      db
        .select({
          ...seat,
          party: candidacy.party,
          cycle: candidacy.cycle,
          outcome: candidacy.outcome,
          fecCandidateId: candidacy.fecCandidateId,
          ...provenanceFields(candidacy),
        })
        .from(candidacy)
        .innerJoin(office, eq(office.id, candidacy.officeId))
        .where(eq(candidacy.personId, row.id))
        .orderBy(desc(candidacy.cycle)),
      db
        .select({
          cycle: platformPosition.cycle,
          policyAreaId: policyArea.id,
          policyAreaName: policyArea.name,
          stance: platformPosition.stance,
          sourceUrl: platformPosition.sourceUrl,
          ...provenanceFields(platformPosition),
        })
        .from(platformPosition)
        .innerJoin(policyArea, eq(policyArea.id, platformPosition.policyAreaId))
        .where(eq(platformPosition.personId, row.id))
        .orderBy(desc(platformPosition.cycle), asc(policyArea.name)),
    ]);

    const { id: _id, ...personFields } = row;
    return {
      person: withProvenance(personFields),
      card: card.row,
      identifiers,
      terms: terms.map(withProvenance),
      candidacies: candidacies.map(withProvenance),
      platform: platform.map(withProvenance).map(({ policyAreaId, policyAreaName, ...p }) => ({
        ...p,
        policyArea: { id: policyAreaId, name: policyAreaName },
      })),
    };
  },
});

// people.compare@1 -----------------------------------------------------------

export const PeopleCompareInput = z.strictObject({
  slugs: z
    .array(SlugSchema)
    .min(2)
    .max(4)
    .refine((slugs) => new Set(slugs).size === slugs.length, 'Slugs must be distinct'),
});

export const PeopleCompareOutput = z.object({
  people: z.array(PersonCardRowSchema).describe('In input order'),
  voteAgreement: z
    .array(
      z.object({
        a: SlugSchema,
        b: SlugSchema,
        sharedVotes: z.int().describe('Rollcalls where both voted yea or nay'),
        agreed: z.int(),
        rate: ShareSchema.nullable(),
      }),
    )
    .describe('Pairwise agreement on recorded yea/nay votes'),
});

export const peopleCompare = defineCapability({
  name: 'people.compare',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Two to four people side by side, with pairwise yea/nay vote agreement.',
  input: PeopleCompareInput,
  output: PeopleCompareOutput,
  async handler({ db }, { slugs }) {
    const cards = await selectCards(db, { where: inArray(personCard.slug, slugs) });
    const missing = slugs.filter((slug) => !cards.some((c) => c.slug === slug));
    if (missing.length > 0) throw notFound(`No person with slug: ${missing.join(', ')}`);

    const ids = await personIdsBySlug(db, slugs);
    const agreement = await pairwiseAgreement(db, [...ids.values()]);
    const voteAgreement = slugs.flatMap((a, i) =>
      slugs.slice(i + 1).map((b) => {
        const [low, high] = [ids.get(a) ?? 0, ids.get(b) ?? 0].sort((x, y) => x - y);
        const pair = agreement.get(`${low}:${high}`) ?? { shared: 0, agreed: 0 };
        return {
          a,
          b,
          sharedVotes: pair.shared,
          agreed: pair.agreed,
          rate: pair.shared > 0 ? pair.agreed / pair.shared : null,
        };
      }),
    );
    return {
      people: slugs.flatMap((slug) => cards.filter((c) => c.slug === slug)),
      voteAgreement,
    };
  },
});

async function personIdsBySlug(db: Db, slugs: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: person.id, slug: person.slug })
    .from(person)
    .where(inArray(person.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function pairwiseAgreement(
  db: Db,
  personIds: number[],
): Promise<Map<string, { shared: number; agreed: number }>> {
  const a = alias(votePosition, 'a');
  const b = alias(votePosition, 'b');
  const recorded = ['yea', 'nay'] as const;
  const rows = await db
    .select({
      a: a.personId,
      b: b.personId,
      shared: sql<number>`count(*)::int`,
      agreed: sql<number>`(count(*) filter (where ${a.position} = ${b.position}))::int`,
    })
    .from(a)
    .innerJoin(b, and(eq(a.rollcallId, b.rollcallId), lt(a.personId, b.personId)))
    .where(
      and(
        inArray(a.personId, personIds),
        inArray(b.personId, personIds),
        inArray(a.position, recorded),
        inArray(b.position, recorded),
      ),
    )
    .groupBy(a.personId, b.personId);
  return new Map(rows.map((r) => [`${r.a}:${r.b}`, { shared: r.shared, agreed: r.agreed }]));
}
