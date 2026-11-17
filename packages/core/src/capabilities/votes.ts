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
import { and, asc, desc, eq, exists, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { ambiguousTerm, voteTimeTerm } from '../frameworks/membership';
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

const TALLY_CHECK_STATUSES = ['matches_source', 'differs_from_source'] as const;

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
      sourceTally: z
        .object({ yea: z.int(), nay: z.int() })
        .describe('Yea and nay totals as recorded by the source on the rollcall itself'),
      tallyCheck: z
        .object({
          status: z.enum(TALLY_CHECK_STATUSES),
          yeaDifference: z.int().describe('tally.yea minus sourceTally.yea'),
          nayDifference: z.int().describe('tally.nay minus sourceTally.nay'),
        })
        .describe(
          '`tally` is reconstructed from stored member positions; this compares it with the source totals. A difference means the stored positions are incomplete or coded differently (e.g. paired votes are stored as not voting).',
        ),
      ambiguousTermPositions: z
        .int()
        .describe(
          'Stored positions whose member had more than one term covering the vote date; each still counts once, under the deterministically chosen term',
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
          yeaCount: rollcall.yeaCount,
          nayCount: rollcall.nayCount,
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
      items: page.map(({ id, yeaCount, nayCount, ...rc }) => {
        const tally = tallies.get(id)?.total ?? emptyTally();
        const yeaDifference = tally.yea - yeaCount;
        const nayDifference = tally.nay - nayCount;
        return {
          rollcall: withProvenance(rc),
          bill: bills.get(id)?.bill ?? null,
          policyArea: bills.get(id)?.policyArea ?? null,
          position: positions.get(id) ?? null,
          tally,
          byParty: tallies.get(id)?.byParty ?? [],
          sourceTally: { yea: yeaCount, nay: nayCount },
          tallyCheck: {
            status:
              yeaDifference === 0 && nayDifference === 0
                ? ('matches_source' as const)
                : ('differs_from_source' as const),
            yeaDifference,
            nayDifference,
          },
          ambiguousTermPositions: tallies.get(id)?.ambiguous ?? 0,
        };
      }),
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
type Position = z.infer<typeof VotePositionSchema>;
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

type PartyRow = { rollcallId: number; party: string; position: Position; count: number };

/**
 * Exactly one party per position, so the party rows always sum to the roll-call total.
 * Fast path: one grouped query joining the term in force on the vote date. It is exact when
 * every position matches exactly one term. A roll call where that does not hold (a member
 * with no term in force, or two overlapping terms) is recomputed on the exact path.
 * `ambiguous` counts the positions whose member had more than one covering term
 * (`ambiguousTerm`, the same flag member states carry); each still counts once.
 */
async function talliesFor(db: Db, rollcallIds: number[]) {
  const result = new Map<
    number,
    { total: Tally; byParty: (Tally & { party: string })[]; ambiguous: number }
  >();
  if (rollcallIds.length === 0) return result;
  const vt = voteTimeTerm(db, votePosition.personId);
  const [fast, counts] = await Promise.all([
    db
      .select({
        rollcallId: votePosition.rollcallId,
        party: sql<string>`coalesce(${term.party}, ${sql.raw(`'${UNKNOWN_PARTY}'`)})`,
        position: votePosition.position,
        count: sql<number>`count(*)::int`,
      })
      .from(votePosition)
      .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
      .leftJoin(
        term,
        and(
          eq(term.personId, votePosition.personId),
          lte(term.startDate, rollcall.voteDate),
          or(isNull(term.endDate), gt(term.endDate, rollcall.voteDate)),
        ),
      )
      .where(inArray(votePosition.rollcallId, rollcallIds))
      .groupBy(
        votePosition.rollcallId,
        sql`coalesce(${term.party}, ${sql.raw(`'${UNKNOWN_PARTY}'`)})`,
        votePosition.position,
      ),
    db
      .select({
        rollcallId: votePosition.rollcallId,
        n: sql<number>`count(*)::int`,
        ambiguous: sql<number>`(count(*) filter (where ${ambiguousTerm(vt)}))::int`,
      })
      .from(votePosition)
      .innerJoin(rollcall, eq(rollcall.id, votePosition.rollcallId))
      .leftJoinLateral(vt, sql`true`)
      .where(inArray(votePosition.rollcallId, rollcallIds))
      .groupBy(votePosition.rollcallId),
  ]);
  const expected = new Map(counts.map((c) => [c.rollcallId, c.n]));
  const ambiguous = new Map(counts.map((c) => [c.rollcallId, c.ambiguous]));
  const got = new Map<number, number>();
  const suspect = new Set<number>();
  for (const row of fast) {
    got.set(row.rollcallId, (got.get(row.rollcallId) ?? 0) + row.count);
    if (row.party === UNKNOWN_PARTY) suspect.add(row.rollcallId);
  }
  for (const [id, n] of expected) if (got.get(id) !== n) suspect.add(id);
  const rows: PartyRow[] = fast.filter((r) => !suspect.has(r.rollcallId));
  if (suspect.size > 0) rows.push(...(await exactParties(db, [...suspect])));

  for (const row of rows) {
    const entry = result.get(row.rollcallId) ?? { total: emptyTally(), byParty: [], ambiguous: 0 };
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
  for (const [id, entry] of result) entry.ambiguous = ambiguous.get(id) ?? 0;
  for (const entry of result.values())
    entry.byParty.sort((a, b) => compareParties(a.party, b.party));
  return result;
}

/**
 * Exact path, one row per position: the term in force on the vote date (inclusive end date;
 * the latest start if a source overlaps two). A position with no term in force, for example a
 * member whose recorded last day is a day or two before their last recorded vote, takes the
 * party of their latest earlier term; only a member with no earlier term is "Unknown".
 */
async function exactParties(db: Db, rollcallIds: number[]): Promise<PartyRow[]> {
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
  const placedRows = await db.select().from(placed);
  const unmatched = placedRows.filter((r) => r.party === null);
  const earlier =
    unmatched.length === 0
      ? []
      : await db
          .select({ personId: term.personId, party: term.party, startDate: term.startDate })
          .from(term)
          .where(inArray(term.personId, [...new Set(unmatched.map((u) => u.personId))]))
          .orderBy(desc(term.startDate));
  return placedRows.map((r) => ({
    rollcallId: r.rollcallId,
    party:
      r.party ??
      earlier.find((t) => t.personId === r.personId && t.startDate <= r.voteDate)?.party ??
      UNKNOWN_PARTY,
    position: r.position,
    count: 1,
  }));
}

async function positionsFor(db: Db, rollcallIds: number[], personId: number) {
  if (rollcallIds.length === 0) return new Map<number, z.infer<typeof VotePositionSchema>>();
  const rows = await db
    .select({ rollcallId: votePosition.rollcallId, position: votePosition.position })
    .from(votePosition)
    .where(and(eq(votePosition.personId, personId), inArray(votePosition.rollcallId, rollcallIds)));
  return new Map(rows.map((r) => [r.rollcallId, r.position]));
}
