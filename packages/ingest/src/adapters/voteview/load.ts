import {
  conflictUpdateSet,
  type Db,
  ideologyScore,
  personIdentifier,
  rollcall,
  type VOTE_POSITIONS,
  votePosition,
} from '@civic-ledger/db';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { LoadContext, LoadCounts } from '../../adapter';
import { kindBatches, lastPerKey, ofKind, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { identifierMap } from '../lookups';
import {
  type MemberRecord,
  type RollcallRecord,
  type VoteRecord,
  type VoteviewRecord,
  voteviewFiles,
} from './parse';

export const DW_NOMINATE = 'dw-nominate';
type Position = (typeof VOTE_POSITIONS)[number];

/**
 * Voteview cast codes → official positions. Paired (2, 5) and announced (3, 4) positions
 * are stated preferences, not recorded votes: the official record lists those members as
 * not voting, so they map to `not_voting` and are counted separately on the receipt.
 * 0 = not a member at the time of the vote: no row (and a row an earlier snapshot loaded
 * for it is withdrawn by the reconciliation).
 */
export function positionForCastCode(
  code: number,
): { position: Position; pairedOrAnnounced: boolean } | null {
  switch (code) {
    case 1:
      return { position: 'yea', pairedOrAnnounced: false };
    case 6:
      return { position: 'nay', pairedOrAnnounced: false };
    case 7:
    case 8:
      return { position: 'present', pairedOrAnnounced: false };
    case 9:
      return { position: 'not_voting', pairedOrAnnounced: false };
    case 2:
    case 3:
    case 4:
    case 5:
      return { position: 'not_voting', pairedOrAnnounced: true };
    case 0:
      return null;
    default:
      throw new Error(`Unknown Voteview cast_code ${code}`);
  }
}

const chamberLetter = (chamber: string) => (chamber === 'house' ? 'H' : 'S');
const chamberName = (chamber: string) => (chamber === 'house' ? 'House' : 'Senate');
const rollKey = (r: { congress: number; chamber: string; number: number }) =>
  `${r.congress}${chamberLetter(r.chamber)}${r.number}`;

/**
 * Completeness thresholds (docs/INGEST.md "Voteview completeness"). A Voteview snapshot is
 * the complete record of its congress, so whatever it no longer asserts is withdrawn by
 * the reconciliation. Before that the snapshot must look complete; otherwise the run is
 * refused and nothing changes. The runtime's per-dataset shrink guard (A51) stays the
 * outer bound on how much one run may delete.
 */
export const VOTEVIEW_COMPLETENESS = {
  /** Refuse when more than this share of member rows matches no person... */
  maxUnmatchedMemberShare: 0.1,
  /** ...judged once the members file has at least this many member rows. */
  unmatchedMemberBaseline: 20,
  /** Refuse when more than this share of vote rows names an icpsr the members file lacks... */
  maxUnknownIcpsrVoteShare: 0.01,
  /** ...judged once the votes file has at least this many rows. */
  unknownIcpsrVoteBaseline: 1_000,
} as const;

export class VoteviewIncompleteError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `voteview snapshot incomplete: ${problems.join('; ')}. Refused before reconciliation; nothing was changed.`,
    );
    this.name = 'VoteviewIncompleteError';
  }
}

const COUNT_KEYS = [
  'members',
  'members_matched',
  'members_without_bioguide',
  'members_bioguide_not_in_legislators',
  'president_rows_skipped',
  'ideology_scores',
  'ideology_provisional',
  'ideology_missing_dim1',
  'icpsr_added',
  'icpsr_differs_from_legislators',
  'icpsr_held_by_other_person',
  'icpsr_reassigned',
  'rollcalls',
  'rollcalls_absent_from_snapshot',
  'vote_positions',
  'vote_positions_paired_or_announced',
  'votes_not_member',
  'votes_president_position_skipped',
  'votes_unmatched_member',
  'votes_icpsr_not_in_members',
  'votes_unknown_rollcall',
  'stale_rows_deleted',
  'stale_vote_positions_deleted',
  'stale_ideology_scores_deleted',
] as const;
type VoteviewCounts = Counts<(typeof COUNT_KEYS)[number]>;

/** Numeric (rollcall, person) key: a congress has ~400k positions, kept off string keys. */
const POSITION_KEY_SPAN = 2 ** 21;

/** What the snapshot asserted, gathered while loading, for the completeness checks. */
interface SnapshotState {
  congress: number;
  files: ReturnType<typeof voteviewFiles>;
  /** icpsr → the Bioguide id the members file gives it (rows with a Bioguide id only). */
  bioguideByIcpsr: Map<string, string>;
  /** `${chamber}|${icpsr}` of every member row, matched or not. */
  listedMembers: Set<string>;
  /** Vote rows (any cast code) per rollcall of the rollcalls file. */
  voteRowsByRollcall: Map<string, number>;
  /** rollcallId * POSITION_KEY_SPAN + personId → the icpsr whose recorded position it holds. */
  positionOwner: Map<number, string>;
  unknownRollcallVotes: number;
  firstUnknownRollcall: string | null;
  voteRows: number;
}

export async function loadVoteview(
  records: AsyncIterable<VoteviewRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  const { db } = ctx;
  if (ctx.scope.kind !== 'congress') throw new Error('voteview needs a congress scope');
  const congress = ctx.scope.congress;
  const byBioguide = await identifierMap(db, 'bioguide');
  const clIcpsr = await identifierMap(db, 'icpsr');
  const icpsrOwner = await icpsrSources(db);
  /** `${chamber}|${icpsr}` → person id, built from this congress's members file. */
  const memberPerson = new Map<string, number>();
  const rollcallIds = new Map<string, number>();
  const presidentIcpsr = new Set<string>();
  const counts: VoteviewCounts = new Counts(COUNT_KEYS);
  const snap: SnapshotState = {
    congress,
    files: voteviewFiles(congress),
    bioguideByIcpsr: new Map(),
    listedMembers: new Set(),
    voteRowsByRollcall: new Map(),
    positionOwner: new Map(),
    unknownRollcallVotes: 0,
    firstUnknownRollcall: null,
    voteRows: 0,
  };
  const checkpoint = () => (ctx.checkpoint ? ctx.checkpoint() : ctx.signal?.throwIfAborted());

  for await (const { kind, items } of kindBatches(records)) {
    if (kind === 'president') {
      counts.add('president_rows_skipped', items.length);
      for (const p of ofKind(items, 'president')) presidentIcpsr.add(p.icpsr);
    }
    if (kind === 'member') {
      await loadMembers(db, ctx, ofKind(items, 'member'), {
        byBioguide,
        clIcpsr,
        icpsrOwner,
        memberPerson,
        counts,
        snap,
      });
    }
    if (kind === 'rollcall') {
      const rows = ofKind(items, 'rollcall');
      await upsertRollcalls(db, ctx, rows, rollcallIds);
      for (const r of rows) snap.voteRowsByRollcall.set(rollKey(r), 0);
      counts.add('rollcalls', rows.length);
    }
    if (kind === 'vote') {
      await loadVotes(db, ctx, ofKind(items, 'vote'), {
        memberPerson,
        rollcallIds,
        presidentIcpsr,
        counts,
        snap,
      });
    }
  }

  checkpoint();
  await assertComplete(db, ctx, snap, counts);
  await reconcile(db, ctx, congress, counts, checkpoint);
  return counts.toJSON();
}

/** Source of each icpsr identifier row, so only rows this source asserted are ever moved. */
async function icpsrSources(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ value: personIdentifier.value, sourceId: personIdentifier.sourceId })
    .from(personIdentifier)
    .where(eq(personIdentifier.scheme, 'icpsr'));
  return new Map(rows.map((r) => [r.value, r.sourceId]));
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** `119H144` → `House 144`. */
function describeRollKey(key: string): string {
  const match = /^\d+([HS])(\d+)$/.exec(key);
  if (!match) return key;
  return `${match[1] === 'H' ? 'House' : 'Senate'} ${match[2]}`;
}

/**
 * Completeness rules C2-C5 and C8 over the whole snapshot (C1 one congress is enforced by
 * the parser with file and line; C6 one Bioguide per icpsr and C7 one position per person
 * and rollcall are refused as soon as they are seen). Each names its first offender. All
 * run before anything is reconciled, and a refusal rolls the whole load back (A50).
 */
async function assertComplete(
  db: Db,
  ctx: LoadContext,
  snap: SnapshotState,
  counts: VoteviewCounts,
): Promise<void> {
  const problems: string[] = [];
  const { files } = snap;
  const t = VOTEVIEW_COMPLETENESS;

  // C2 members present; C8a members resolvable to people.
  const members = counts.get('members');
  if (members === 0) problems.push(`${files.members} has no member rows`);
  const unmatched = members - counts.get('members_matched');
  if (members >= t.unmatchedMemberBaseline && unmatched / members > t.maxUnmatchedMemberShare) {
    problems.push(
      `${unmatched} of ${members} members match no person (limit ${pct(t.maxUnmatchedMemberShare)}; ` +
        'rerun congress-legislators first if it is behind)',
    );
  }

  // C3 an empty rollcalls file cannot withdraw a congress that is already loaded.
  if (snap.voteRowsByRollcall.size === 0) {
    const result = (await db.execute(
      sql`select count(*)::int as n from rollcall where source_id = ${ctx.sourceId} and congress = ${snap.congress}`,
    )) as unknown as { rows: { n: number }[] };
    const existing = result.rows[0]?.n ?? 0;
    if (existing > 0) {
      problems.push(
        `${files.rollcalls} has no rollcalls but ${existing} are loaded for congress ${snap.congress}`,
      );
    }
  }

  // C4 every vote row belongs to a rollcall of the rollcalls file.
  if (snap.unknownRollcallVotes > 0) {
    problems.push(
      `${snap.unknownRollcallVotes} vote rows reference rollcalls missing from ${files.rollcalls} ` +
        `(first: ${snap.firstUnknownRollcall})`,
    );
  }

  // C5 every rollcall of the rollcalls file has vote rows (any cast code).
  const silent = [...snap.voteRowsByRollcall].filter(([, n]) => n === 0).map(([key]) => key);
  if (silent.length > 0) {
    problems.push(
      `${silent.length} rollcalls have no vote rows in ${files.votes} (first: ${describeRollKey(silent[0] ?? '')})`,
    );
  }

  // C8b vote rows name members the members file lists.
  const unknownIcpsr = counts.get('votes_icpsr_not_in_members');
  if (
    snap.voteRows >= t.unknownIcpsrVoteBaseline &&
    unknownIcpsr / snap.voteRows > t.maxUnknownIcpsrVoteShare
  ) {
    problems.push(
      `${unknownIcpsr} of ${snap.voteRows} vote rows name an icpsr missing from ${files.members} ` +
        `(limit ${pct(t.maxUnknownIcpsrVoteShare)})`,
    );
  }

  if (problems.length > 0) throw new VoteviewIncompleteError(problems);
}

/**
 * Withdraws what the complete snapshot no longer asserts. Every row this run upserted
 * carries its ingest_run_id, so a Voteview row of this congress with another run id is one
 * the snapshot did not repeat: a vote now cast_code 0 or gone, a score whose dim1 is now
 * missing, a vote or score under the person an icpsr used to map to. Rollcall rows are
 * kept (BILLSTATUS links them) and counted as `rollcalls_absent_from_snapshot`. The
 * withdrawn assertion stays traceable through the earlier run's receipt and raw snapshot.
 */
async function reconcile(
  db: Db,
  ctx: LoadContext,
  congress: number,
  counts: VoteviewCounts,
  checkpoint: () => void,
): Promise<void> {
  const deleted = async (tx: Db, statement: SQL) => {
    const result = (await tx.execute(
      sql`with d as (${statement} returning 1) select count(*)::int as n from d`,
    )) as unknown as { rows: { n: number }[] };
    return result.rows[0]?.n ?? 0;
  };
  await db.transaction(async (tx) => {
    checkpoint();
    const votes = await deleted(
      tx,
      sql`delete from vote_position
        where source_id = ${ctx.sourceId} and ingest_run_id <> ${ctx.ingestRunId}
          and rollcall_id in (select id from rollcall where congress = ${congress})`,
    );
    checkpoint();
    const scores = await deleted(
      tx,
      sql`delete from ideology_score
        where source_id = ${ctx.sourceId} and ingest_run_id <> ${ctx.ingestRunId}
          and congress = ${congress} and method = ${DW_NOMINATE}`,
    );
    checkpoint();
    const absent = (await tx.execute(
      sql`select count(*)::int as n from rollcall
        where source_id = ${ctx.sourceId} and ingest_run_id <> ${ctx.ingestRunId} and congress = ${congress}`,
    )) as unknown as { rows: { n: number }[] };
    counts.set('stale_vote_positions_deleted', votes);
    counts.set('stale_ideology_scores_deleted', scores);
    counts.set('stale_rows_deleted', votes + scores);
    counts.set('rollcalls_absent_from_snapshot', absent.rows[0]?.n ?? 0);
  });
}

interface MemberState {
  byBioguide: Map<string, number>;
  clIcpsr: Map<string, number>;
  /** icpsr → source_id of its identifier row. */
  icpsrOwner: Map<string, string>;
  memberPerson: Map<string, number>;
  counts: VoteviewCounts;
  snap: SnapshotState;
}

async function loadMembers(db: Db, ctx: LoadContext, members: MemberRecord[], s: MemberState) {
  const { counts, snap } = s;
  const icpsrsByPerson = new Map<number, Set<string>>();
  for (const [value, personId] of s.clIcpsr) {
    icpsrsByPerson.set(personId, (icpsrsByPerson.get(personId) ?? new Set()).add(value));
  }
  const scores: (typeof ideologyScore.$inferInsert)[] = [];
  const newIcpsr: (typeof personIdentifier.$inferInsert)[] = [];
  const movedIcpsr: { value: string; personId: number }[] = [];

  for (const m of members) {
    counts.add('members');
    snap.listedMembers.add(`${m.chamber}|${m.icpsr}`);
    if (!m.bioguide) {
      counts.add('members_without_bioguide');
      continue;
    }
    // C6: one icpsr is one member. Two Bioguide ids for it would put one source vote under
    // two people; never guess which, and never match people by name.
    const listed = snap.bioguideByIcpsr.get(m.icpsr);
    if (listed !== undefined && listed !== m.bioguide) {
      throw new VoteviewIncompleteError([
        `icpsr ${m.icpsr} (${chamberName(m.chamber)}) is listed with Bioguide ${listed} and ${m.bioguide} in ${snap.files.members}`,
      ]);
    }
    snap.bioguideByIcpsr.set(m.icpsr, m.bioguide);
    const personId = s.byBioguide.get(m.bioguide);
    if (personId === undefined) {
      counts.add('members_bioguide_not_in_legislators');
      continue;
    }
    counts.add('members_matched');
    s.memberPerson.set(`${m.chamber}|${m.icpsr}`, personId);

    // Cross-check by bioguide (never join on icpsr alone: c-l lacks many, and Voteview
    // assigns a new icpsr when a member switches party).
    const holder = s.clIcpsr.get(m.icpsr);
    const known = icpsrsByPerson.get(personId);
    if (holder !== undefined && holder !== personId) {
      if (s.icpsrOwner.get(m.icpsr) === ctx.sourceId) {
        // Voteview asserted the old link itself and now corrects it: follow the source.
        movedIcpsr.push({ value: m.icpsr, personId });
        s.clIcpsr.set(m.icpsr, personId);
      } else {
        // Another source (congress-legislators) owns that identifier: report, never move it.
        counts.add('icpsr_held_by_other_person');
      }
    } else if (holder === undefined) {
      if (known && known.size > 0) counts.add('icpsr_differs_from_legislators');
      newIcpsr.push({
        personId,
        scheme: 'icpsr',
        value: m.icpsr,
        ...provenance(ctx, `icpsr:${m.icpsr}`),
      });
      s.clIcpsr.set(m.icpsr, personId);
      s.icpsrOwner.set(m.icpsr, ctx.sourceId);
    }

    if (m.dim1 === null) {
      counts.add('ideology_missing_dim1');
      continue;
    }
    if (m.provisional) counts.add('ideology_provisional');
    scores.push({
      personId,
      congress: m.congress,
      method: DW_NOMINATE,
      dim1: m.dim1,
      dim2: m.dim2,
      provisional: m.provisional,
      ...provenance(ctx, `${m.congress}:${m.chamber}:${m.icpsr}`),
    });
  }

  await db.transaction(async (tx) => {
    if (newIcpsr.length > 0) {
      const added = await tx
        .insert(personIdentifier)
        .values(lastPerKey(newIcpsr, (r) => r.value))
        .onConflictDoNothing({ target: [personIdentifier.scheme, personIdentifier.value] })
        .returning({ id: personIdentifier.id });
      counts.add('icpsr_added', added.length);
    }
    for (const moved of lastPerKey(movedIcpsr, (r) => r.value)) {
      const updated = await tx
        .update(personIdentifier)
        .set({ personId: moved.personId, ...provenance(ctx, `icpsr:${moved.value}`) })
        .where(
          and(
            eq(personIdentifier.scheme, 'icpsr'),
            eq(personIdentifier.value, moved.value),
            eq(personIdentifier.sourceId, ctx.sourceId),
          ),
        )
        .returning({ id: personIdentifier.id });
      counts.add('icpsr_reassigned', updated.length);
    }
    // DW-NOMINATE is one career estimate per member, repeated on each chamber row.
    const unique = lastPerKey(scores, (r) => `${r.personId}|${r.congress}`);
    if (unique.length > 0) {
      await tx
        .insert(ideologyScore)
        .values(unique)
        .onConflictDoUpdate({
          target: [ideologyScore.personId, ideologyScore.congress, ideologyScore.method],
          set: conflictUpdateSet(ideologyScore),
        });
    }
    counts.add('ideology_scores', unique.length);
  });
}

async function upsertRollcalls(
  db: Db,
  ctx: LoadContext,
  rows: RollcallRecord[],
  ids: Map<string, number>,
) {
  const values = lastPerKey(rows, rollKey).map((r) => ({
    congress: r.congress,
    chamber: r.chamber,
    number: r.number,
    session: r.session,
    clerkNumber: r.clerkNumber,
    voteDate: r.date,
    question: r.question,
    description: r.description,
    result: r.result,
    yeaCount: r.yeaCount,
    nayCount: r.nayCount,
    ...provenance(ctx, rollKey(r)),
  }));
  const inserted = await db.transaction((tx) =>
    tx
      .insert(rollcall)
      .values(values)
      .onConflictDoUpdate({
        target: [rollcall.congress, rollcall.chamber, rollcall.number],
        set: conflictUpdateSet(rollcall),
      })
      .returning({
        id: rollcall.id,
        congress: rollcall.congress,
        chamber: rollcall.chamber,
        number: rollcall.number,
      }),
  );
  for (const r of inserted) ids.set(rollKey(r), r.id);
}

interface VoteState {
  memberPerson: Map<string, number>;
  rollcallIds: Map<string, number>;
  presidentIcpsr: Set<string>;
  counts: VoteviewCounts;
  snap: SnapshotState;
}

async function loadVotes(db: Db, ctx: LoadContext, votes: VoteRecord[], s: VoteState) {
  const { snap } = s;
  const rows: (typeof votePosition.$inferInsert)[] = [];
  for (const v of votes) {
    snap.voteRows++;
    const key = rollKey(v);
    const seen = snap.voteRowsByRollcall.get(key);
    if (seen === undefined) {
      // C4: counted here, refused by assertComplete before anything is reconciled.
      snap.unknownRollcallVotes++;
      snap.firstUnknownRollcall ??= `${chamberName(v.chamber)} ${v.number}`;
      s.counts.add('votes_unknown_rollcall');
      continue;
    }
    snap.voteRowsByRollcall.set(key, seen + 1);
    const president = s.presidentIcpsr.has(v.icpsr);
    if (!president && !snap.listedMembers.has(`${v.chamber}|${v.icpsr}`)) {
      s.counts.add('votes_icpsr_not_in_members');
    }
    const mapped = positionForCastCode(v.castCode);
    if (!mapped) {
      s.counts.add('votes_not_member');
      continue;
    }
    if (president) {
      s.counts.add('votes_president_position_skipped');
      continue;
    }
    const personId = s.memberPerson.get(`${v.chamber}|${v.icpsr}`);
    if (personId === undefined) {
      s.counts.add('votes_unmatched_member');
      continue;
    }
    const rollcallId = s.rollcallIds.get(key);
    if (rollcallId === undefined) throw new Error(`rollcall ${key} was listed but not loaded`);
    // C7: one recorded position per person and rollcall. Two icpsrs mapping to one person
    // on the same rollcall would silently keep one source vote and drop the other.
    if (personId >= POSITION_KEY_SPAN) throw new Error(`person id ${personId} out of key range`);
    const owner = rollcallId * POSITION_KEY_SPAN + personId;
    const first = snap.positionOwner.get(owner);
    if (first !== undefined && first !== v.icpsr) {
      throw new VoteviewIncompleteError([
        `two icpsrs (${first}, ${v.icpsr}) map to one person on ${chamberName(v.chamber)} rollcall ${v.number}`,
      ]);
    }
    snap.positionOwner.set(owner, v.icpsr);
    if (mapped.pairedOrAnnounced) s.counts.add('vote_positions_paired_or_announced');
    rows.push({
      rollcallId,
      personId,
      position: mapped.position,
      ...provenance(ctx, `${key}:${v.icpsr}`),
    });
  }
  const unique = lastPerKey(rows, (r) => `${r.rollcallId}|${r.personId}`);
  if (unique.length === 0) return;
  await db.transaction((tx) =>
    tx
      .insert(votePosition)
      .values(unique)
      .onConflictDoUpdate({
        target: [votePosition.rollcallId, votePosition.personId],
        set: conflictUpdateSet(votePosition),
      }),
  );
  s.counts.add('vote_positions', unique.length);
}
