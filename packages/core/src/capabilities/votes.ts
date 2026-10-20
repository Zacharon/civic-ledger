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
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
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
        .describe(
          "Party = the member's party on their term at the vote date. Rows are alphabetical by party name (no ideological or size order), 'Unknown' (no term started by the vote date) last, and always sum to `tally`.",
        ),
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
          session: rollcall.session,
          clerkNumber: rollcall.clerkNumber,
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

/**
 * The party label for members with no term started by the vote date. Shown as its own row,
 * never folded into a real party.
 */
export const UNKNOWN_PARTY = 'Unknown';

/**
 * Party order shared by every per-party list: alphabetical by party name, with the
 * "no party on file" row last. No ideological or size-based order.
 */
export function compareParties(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNKNOWN_PARTY) return 1;
  if (b === UNKNOWN_PARTY) return -1;
  return a.localeCompare(b, 'en');
}

async function talliesFor(db: Db, rollcallIds: number[]) {
  const result = new Map<number, { total: Tally; byParty: (Tally & { party: string })[] }>();
  if (rollcallIds.length === 0) return result;
  // Exactly one party per position, so the party rows always sum to the roll-call total.
  // The term in force on the vote date wins (inclusive end date; the latest start if a source
  // ever overlaps two). A position with no term in force, for example a member whose recorded
  // last day is a day or two before their last recorded vote, takes the party of their
  // latest earlier term, and only a member with no earlier term is "Unknown".
  const placed = db
    .selectDistinctOn([votePosition.id], {
      rollcallId: votePosition.rollcallId,
      personId: votePosition.personId,
      voteDate: rollcall.voteDate,
      position: votePosition.position,
      party: term.party,
    })
    .from(votePosition)
    .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
    .leftJoin(
      term,
      and(
        eq(term.personId, votePosition.personId),
        lte(term.startDate, rollcall.voteDate),
        or(isNull(term.endDate), gte(term.endDate, rollcall.voteDate)),
      ),
    )
    .where(inArray(votePosition.rollcallId, rollcallIds))
    .orderBy(votePosition.id, desc(term.startDate))
    .as('placed');
  const [matched, unmatched] = await Promise.all([
    db
      .select({
        rollcallId: placed.rollcallId,
        party: sql<string>`${placed.party}`,
        position: placed.position,
        count: sql<number>`count(*)::int`,
      })
      .from(placed)
      .where(isNotNull(placed.party))
      .groupBy(placed.rollcallId, placed.party, placed.position),
    db
      .select({
        rollcallId: placed.rollcallId,
        personId: placed.personId,
        voteDate: placed.voteDate,
        position: placed.position,
      })
      .from(placed)
      .where(isNull(placed.party)),
  ]);
  const rows = [...matched];
  if (unmatched.length > 0) {
    const earlier = await db
      .select({ personId: term.personId, party: term.party, startDate: term.startDate })
      .from(term)
      .where(inArray(term.personId, [...new Set(unmatched.map((u) => u.personId))]))
      .orderBy(desc(term.startDate));
    for (const u of unmatched) {
      const party =
        earlier.find((t) => t.personId === u.personId && t.startDate <= u.voteDate)?.party ??
        UNKNOWN_PARTY;
      rows.push({ rollcallId: u.rollcallId, party, position: u.position, count: 1 });
    }
  }
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
  for (const entry of result.values())
    entry.byParty.sort((a, b) => compareParties(a.party, b.party));
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
