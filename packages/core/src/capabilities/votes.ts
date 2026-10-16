import {
  bill,
  billPolicyArea,
  type Db,
  person,
  policyArea,
  rollcall,
  rollcallBill,
  term,
  votePosition,
} from '@civic-ledger/db';
import { and, asc, desc, eq, exists, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  BillRefSchema,
  ChamberSchema,
  CongressSchema,
  PageSchema,
  PaginationInput,
  PersonRefSchema,
  PolicyAreaRefSchema,
  ProvenanceSchema,
  RollcallRefSchema,
  SlugSchema,
  VotePositionSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

const TallySchema = z.object({
  yea: z.int(),
  nay: z.int(),
  present: z.int(),
  notVoting: z.int(),
});
type Tally = z.infer<typeof TallySchema>;

export const VotesListInput = z.strictObject({
  slug: SlugSchema.optional().describe(
    'Only rollcalls this person was eligible for, with their position',
  ),
  policyArea: SlugSchema.optional().describe('Policy area id, e.g. "health"'),
  congress: CongressSchema.optional(),
  chamber: ChamberSchema.optional(),
  ...PaginationInput,
});

export const VotesListOutput = z.object({
  person: PersonRefSchema.nullable(),
  items: z.array(
    z.object({
      rollcall: RollcallRefSchema.extend({ provenance: ProvenanceSchema }),
      bill: BillRefSchema.nullable(),
      policyArea: PolicyAreaRefSchema.nullable(),
      position: VotePositionSchema.nullable().describe("The requested person's position"),
      tally: TallySchema,
      byParty: z
        .array(TallySchema.extend({ party: z.string() }))
        .describe("Party = the member's party on their term at the vote date"),
    }),
  ),
  ...PageSchema,
});

export const votesList = defineCapability({
  name: 'votes.list',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Rollcalls (newest first) with bill, policy area, tallies and optionally one member’s position.',
  input: VotesListInput,
  output: VotesListOutput,
  async handler({ db }, input) {
    const who = input.slug ? await findPerson(db, input.slug) : null;
    if (input.policyArea) await assertPolicyArea(db, input.policyArea);

    const where = and(
      input.congress ? eq(rollcall.congress, input.congress) : undefined,
      input.chamber ? eq(rollcall.chamber, input.chamber) : undefined,
      who
        ? exists(
            db
              .select({ one: sql`1` })
              .from(votePosition)
              .where(
                and(eq(votePosition.rollcallId, rollcall.id), eq(votePosition.personId, who.id)),
              ),
          )
        : undefined,
      input.policyArea
        ? inArray(
            rollcall.id,
            db
              .select({ id: rollcallBill.rollcallId })
              .from(rollcallBill)
              .innerJoin(billPolicyArea, eq(billPolicyArea.billId, rollcallBill.billId))
              .where(eq(billPolicyArea.policyAreaId, input.policyArea)),
          )
        : undefined,
    );

    const [page, [count]] = await Promise.all([
      db
        .select({
          id: rollcall.id,
          congress: rollcall.congress,
          chamber: rollcall.chamber,
          number: rollcall.number,
          voteDate: rollcall.voteDate,
          question: rollcall.question,
          result: rollcall.result,
          ...provenanceFields(rollcall),
        })
        .from(rollcall)
        .where(where)
        .orderBy(desc(rollcall.voteDate), asc(rollcall.chamber), desc(rollcall.number))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(rollcall).where(where),
    ]);

    const ids = page.map((r) => r.id);
    const [bills, tallies, positions] = await Promise.all([
      billsFor(db, ids),
      talliesFor(db, ids),
      who ? positionsFor(db, ids, who.id) : new Map<number, z.infer<typeof VotePositionSchema>>(),
    ]);

    return {
      person: who ? { slug: who.slug, fullName: who.fullName } : null,
      items: page.map(({ id, ...rc }) => ({
        rollcall: withProvenance(rc),
        bill: bills.get(id)?.bill ?? null,
        policyArea: bills.get(id)?.policyArea ?? null,
        position: positions.get(id) ?? null,
        tally: tallies.get(id)?.total ?? emptyTally(),
        byParty: tallies.get(id)?.byParty ?? [],
      })),
      total: count?.total ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  },
});

async function findPerson(db: Db, slug: string) {
  const [who] = await db
    .select({ id: person.id, slug: person.slug, fullName: person.fullName })
    .from(person)
    .where(eq(person.slug, slug))
    .limit(1);
  if (!who) throw notFound(`No person with slug "${slug}"`);
  return who;
}

async function assertPolicyArea(db: Db, id: string): Promise<void> {
  const [area] = await db
    .select({ id: policyArea.id })
    .from(policyArea)
    .where(eq(policyArea.id, id));
  if (!area) throw notFound(`No policy area "${id}"`);
}

/** The bill each rollcall acted on; a final-passage link wins when there are several. */
async function billsFor(db: Db, rollcallIds: number[]) {
  const result = new Map<
    number,
    { bill: z.infer<typeof BillRefSchema>; policyArea: z.infer<typeof PolicyAreaRefSchema> | null }
  >();
  if (rollcallIds.length === 0) return result;
  const rows = await db
    .select({
      rollcallId: rollcallBill.rollcallId,
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      title: bill.title,
      url: bill.url,
      policyAreaId: policyArea.id,
      policyAreaName: policyArea.name,
    })
    .from(rollcallBill)
    .innerJoin(bill, eq(bill.id, rollcallBill.billId))
    .leftJoin(billPolicyArea, eq(billPolicyArea.billId, bill.id))
    .leftJoin(policyArea, eq(policyArea.id, billPolicyArea.policyAreaId))
    .where(inArray(rollcallBill.rollcallId, rollcallIds))
    .orderBy(desc(rollcallBill.isFinalPassage), asc(bill.id));
  for (const { rollcallId, policyAreaId, policyAreaName, ...billRef } of rows) {
    if (result.has(rollcallId)) continue;
    result.set(rollcallId, {
      bill: billRef,
      policyArea:
        policyAreaId === null || policyAreaName === null
          ? null
          : { id: policyAreaId, name: policyAreaName },
    });
  }
  return result;
}

const emptyTally = (): Tally => ({ yea: 0, nay: 0, present: 0, notVoting: 0 });
const TALLY_KEY = { yea: 'yea', nay: 'nay', present: 'present', not_voting: 'notVoting' } as const;

async function talliesFor(db: Db, rollcallIds: number[]) {
  const result = new Map<number, { total: Tally; byParty: (Tally & { party: string })[] }>();
  if (rollcallIds.length === 0) return result;
  const party = sql<string>`coalesce(${term.party}, 'Unknown')`;
  const rows = await db
    .select({
      rollcallId: votePosition.rollcallId,
      party,
      position: votePosition.position,
      count: sql<number>`count(*)::int`,
    })
    .from(votePosition)
    .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
    .leftJoin(
      term,
      and(
        eq(term.personId, votePosition.personId),
        gte(rollcall.voteDate, term.startDate),
        or(isNull(term.endDate), lt(rollcall.voteDate, term.endDate)),
      ),
    )
    .where(inArray(votePosition.rollcallId, rollcallIds))
    .groupBy(votePosition.rollcallId, party, votePosition.position)
    .orderBy(asc(party));
  for (const row of rows) {
    const entry = result.get(row.rollcallId) ?? { total: emptyTally(), byParty: [] };
    let partyTally = entry.byParty.find((p) => p.party === row.party);
    if (!partyTally) {
      partyTally = { party: row.party, ...emptyTally() };
      entry.byParty.push(partyTally);
    }
    const key = TALLY_KEY[row.position];
    entry.total[key] += row.count;
    partyTally[key] += row.count;
    result.set(row.rollcallId, entry);
  }
  return result;
}

async function positionsFor(db: Db, rollcallIds: number[], personId: number) {
  if (rollcallIds.length === 0) return new Map<number, z.infer<typeof VotePositionSchema>>();
  const rows = await db
    .select({ rollcallId: votePosition.rollcallId, position: votePosition.position })
    .from(votePosition)
    .where(and(eq(votePosition.personId, personId), inArray(votePosition.rollcallId, rollcallIds)));
  return new Map(rows.map((r) => [r.rollcallId, r.position]));
}
