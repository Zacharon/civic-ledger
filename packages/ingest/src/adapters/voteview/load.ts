import {
  conflictUpdateSet,
  type Db,
  ideologyScore,
  personIdentifier,
  rollcall,
  type VOTE_POSITIONS,
  votePosition,
} from '@civic-ledger/db';
import type { LoadContext, LoadCounts } from '../../adapter';
import { kindBatches, lastPerKey, ofKind, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { identifierMap } from '../lookups';
import type { MemberRecord, RollcallRecord, VoteRecord, VoteviewRecord } from './parse';

export const DW_NOMINATE = 'dw-nominate';
type Position = (typeof VOTE_POSITIONS)[number];

/**
 * Voteview cast codes → official positions. Paired (2, 5) and announced (3, 4) positions
 * are stated preferences, not recorded votes: the official record lists those members as
 * not voting, so they map to `not_voting` and are counted separately on the receipt.
 * 0 = not a member at the time of the vote (no row).
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
const rollKey = (r: { congress: number; chamber: string; number: number }) =>
  `${r.congress}${chamberLetter(r.chamber)}${r.number}`;

export async function loadVoteview(
  records: AsyncIterable<VoteviewRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  const { db } = ctx;
  const byBioguide = await identifierMap(db, 'bioguide');
  const clIcpsr = await identifierMap(db, 'icpsr');
  /** `${chamber}|${icpsr}` → person id, built from this congress's members file. */
  const memberPerson = new Map<string, number>();
  const rollcallIds = new Map<string, number>();
  const presidentIcpsr = new Set<string>();
  const counts = new Counts([
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
    'rollcalls',
    'vote_positions',
    'vote_positions_paired_or_announced',
    'votes_not_member',
    'votes_president_position_skipped',
    'votes_unmatched_member',
    'votes_unknown_rollcall',
  ] as const);

  for await (const { kind, items } of kindBatches(records)) {
    if (kind === 'president') {
      counts.add('president_rows_skipped', items.length);
      for (const p of ofKind(items, 'president')) presidentIcpsr.add(p.icpsr);
    }
    if (kind === 'member') {
      await loadMembers(db, ctx, ofKind(items, 'member'), {
        byBioguide,
        clIcpsr,
        memberPerson,
        counts,
      });
    }
    if (kind === 'rollcall') {
      const rows = ofKind(items, 'rollcall');
      await upsertRollcalls(db, ctx, rows, rollcallIds);
      counts.add('rollcalls', rows.length);
    }
    if (kind === 'vote') {
      await loadVotes(db, ctx, ofKind(items, 'vote'), {
        memberPerson,
        rollcallIds,
        presidentIcpsr,
        counts,
      });
    }
  }
  return counts.toJSON();
}

type VoteviewCounts = Counts<
  | 'members'
  | 'members_matched'
  | 'members_without_bioguide'
  | 'members_bioguide_not_in_legislators'
  | 'president_rows_skipped'
  | 'ideology_scores'
  | 'ideology_provisional'
  | 'ideology_missing_dim1'
  | 'icpsr_added'
  | 'icpsr_differs_from_legislators'
  | 'icpsr_held_by_other_person'
  | 'rollcalls'
  | 'vote_positions'
  | 'vote_positions_paired_or_announced'
  | 'votes_not_member'
  | 'votes_president_position_skipped'
  | 'votes_unmatched_member'
  | 'votes_unknown_rollcall'
>;

interface MemberState {
  byBioguide: Map<string, number>;
  clIcpsr: Map<string, number>;
  memberPerson: Map<string, number>;
  counts: VoteviewCounts;
}

async function loadMembers(db: Db, ctx: LoadContext, members: MemberRecord[], s: MemberState) {
  const { counts } = s;
  const icpsrsByPerson = new Map<number, Set<string>>();
  for (const [value, personId] of s.clIcpsr) {
    icpsrsByPerson.set(personId, (icpsrsByPerson.get(personId) ?? new Set()).add(value));
  }
  const scores: (typeof ideologyScore.$inferInsert)[] = [];
  const newIcpsr: (typeof personIdentifier.$inferInsert)[] = [];

  for (const m of members) {
    counts.add('members');
    if (!m.bioguide) {
      counts.add('members_without_bioguide');
      continue;
    }
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
      counts.add('icpsr_held_by_other_person');
    } else if (holder === undefined) {
      if (known && known.size > 0) counts.add('icpsr_differs_from_legislators');
      newIcpsr.push({
        personId,
        scheme: 'icpsr',
        value: m.icpsr,
        ...provenance(ctx, `icpsr:${m.icpsr}`),
      });
      s.clIcpsr.set(m.icpsr, personId);
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
}

async function loadVotes(db: Db, ctx: LoadContext, votes: VoteRecord[], s: VoteState) {
  const rows: (typeof votePosition.$inferInsert)[] = [];
  for (const v of votes) {
    const mapped = positionForCastCode(v.castCode);
    if (!mapped) {
      s.counts.add('votes_not_member');
      continue;
    }
    if (s.presidentIcpsr.has(v.icpsr)) {
      s.counts.add('votes_president_position_skipped');
      continue;
    }
    const personId = s.memberPerson.get(`${v.chamber}|${v.icpsr}`);
    if (personId === undefined) {
      s.counts.add('votes_unmatched_member');
      continue;
    }
    const rollcallId = s.rollcallIds.get(rollKey(v));
    if (rollcallId === undefined) {
      s.counts.add('votes_unknown_rollcall');
      continue;
    }
    if (mapped.pairedOrAnnounced) s.counts.add('vote_positions_paired_or_announced');
    rows.push({
      rollcallId,
      personId,
      position: mapped.position,
      ...provenance(ctx, `${rollKey(v)}:${v.icpsr}`),
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
