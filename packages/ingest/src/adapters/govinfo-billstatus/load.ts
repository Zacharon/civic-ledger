import {
  bill,
  billPolicyArea,
  billSubject,
  conflictUpdateSet,
  type Db,
  policyArea,
  rollcall,
  rollcallBill,
} from '@civic-ledger/db';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { LoadContext, LoadCounts } from '../../adapter';
import { slugify } from '../../parse/values';
import { chunked, lastPerKey, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { identifierMap } from '../lookups';
import { isFinalPassageQuestion } from './final-passage';
import type { BillRecord } from './parse';

const COUNT_KEYS = [
  'bills',
  'bills_sponsor_matched',
  'bills_sponsor_unmatched',
  'bills_without_policy_area',
  'policy_areas_from_source',
  'bill_policy_areas',
  'bill_subjects',
  'recorded_votes',
  'rollcall_links',
  'rollcall_links_final_passage',
  'recorded_votes_without_rollcall',
  'stale_rows_deleted',
] as const;

const billKey = (b: { congress: number; billType: string; number: number }) =>
  `${b.congress}${b.billType}${b.number}`;
const voteKey = (v: {
  congress: number;
  chamber: string;
  session: number | null;
  clerk: number | null;
}) => `${v.congress}|${v.chamber}|${v.session}|${v.clerk}`;

interface RollcallRef {
  id: number;
  finalPassage: boolean;
}

/** Joins BILLSTATUS recorded votes to Voteview rollcalls on (congress, chamber, session, clerk number). */
async function rollcallsByClerkNumber(db: Db, congress: number): Promise<Map<string, RollcallRef>> {
  const rows = await db
    .select({
      id: rollcall.id,
      congress: rollcall.congress,
      chamber: rollcall.chamber,
      session: rollcall.session,
      clerk: rollcall.clerkNumber,
      question: rollcall.question,
    })
    .from(rollcall)
    .where(eq(rollcall.congress, congress));
  return new Map(
    rows.map((r) => [voteKey(r), { id: r.id, finalPassage: isFinalPassageQuestion(r.question) }]),
  );
}

export async function loadBillstatus(
  records: AsyncIterable<BillRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  if (ctx.scope.kind !== 'congress') throw new Error('govinfo-billstatus needs a congress scope');
  const { db } = ctx;
  const congress = ctx.scope.congress;
  const counts = new Counts(COUNT_KEYS);
  const byBioguide = await identifierMap(db, 'bioguide');
  const rollcalls = await rollcallsByClerkNumber(db, congress);
  const knownAreas = new Set(
    (await db.select({ id: policyArea.id }).from(policyArea)).map((p) => p.id),
  );

  for await (const batch of chunked(records, 500)) {
    const bills = lastPerKey(batch, billKey);
    await db.transaction(async (tx) => {
      const newAreas = lastPerKey(
        bills.flatMap((b) =>
          b.policyArea ? [{ id: slugify(b.policyArea), name: b.policyArea }] : [],
        ),
        (a) => a.id,
      ).filter((a) => !knownAreas.has(a.id));
      if (newAreas.length > 0) {
        await tx.insert(policyArea).values(newAreas).onConflictDoNothing();
        for (const a of newAreas) knownAreas.add(a.id);
        counts.add('policy_areas_from_source', newAreas.length);
      }

      const inserted = await tx
        .insert(bill)
        .values(
          bills.map((b) => {
            const sponsor = b.sponsorBioguide ? (byBioguide.get(b.sponsorBioguide) ?? null) : null;
            if (b.sponsorBioguide)
              counts.add(sponsor === null ? 'bills_sponsor_unmatched' : 'bills_sponsor_matched');
            if (!b.policyArea) counts.add('bills_without_policy_area');
            return {
              congress: b.congress,
              billType: b.billType,
              number: b.number,
              title: b.title,
              introducedDate: b.introducedDate,
              sponsorPersonId: sponsor,
              latestActionText: b.latestActionText,
              latestActionDate: b.latestActionDate,
              url: b.url,
              ...provenance(ctx, `BILLSTATUS-${billKey(b)}`),
            };
          }),
        )
        .onConflictDoUpdate({
          target: [bill.congress, bill.billType, bill.number],
          set: conflictUpdateSet(bill),
        })
        .returning({
          id: bill.id,
          congress: bill.congress,
          billType: bill.billType,
          number: bill.number,
        });
      const billIds = new Map(inserted.map((b) => [billKey(b), b.id]));
      const idOf = (b: BillRecord) => {
        const id = billIds.get(billKey(b));
        if (id === undefined) throw new Error(`No bill id for ${billKey(b)}`);
        return id;
      };

      const areaRows = bills.flatMap((b) =>
        b.policyArea
          ? [
              {
                billId: idOf(b),
                policyAreaId: slugify(b.policyArea),
                ...provenance(ctx, `BILLSTATUS-${billKey(b)}:policyArea`),
              },
            ]
          : [],
      );
      if (areaRows.length > 0) {
        await tx
          .insert(billPolicyArea)
          .values(areaRows)
          .onConflictDoUpdate({
            target: [billPolicyArea.billId, billPolicyArea.policyAreaId],
            set: conflictUpdateSet(billPolicyArea),
          });
      }

      const subjectRows = bills.flatMap((b) =>
        b.subjects.map((subject) => ({
          billId: idOf(b),
          subject,
          ...provenance(ctx, `BILLSTATUS-${billKey(b)}:subject`),
        })),
      );
      for (let i = 0; i < subjectRows.length; i += 1_000) {
        await tx
          .insert(billSubject)
          .values(subjectRows.slice(i, i + 1_000))
          .onConflictDoUpdate({
            target: [billSubject.billId, billSubject.subject],
            set: conflictUpdateSet(billSubject),
          });
      }

      const links = bills.flatMap((b) =>
        b.recordedVotes.flatMap((v) => {
          counts.add('recorded_votes');
          const ref = rollcalls.get(voteKey({ ...v, clerk: v.rollNumber }));
          if (!ref) {
            counts.add('recorded_votes_without_rollcall');
            return [];
          }
          return [
            {
              rollcallId: ref.id,
              billId: idOf(b),
              isFinalPassage: ref.finalPassage,
              ...provenance(
                ctx,
                `BILLSTATUS-${billKey(b)}:vote:${v.chamber}:${v.session}:${v.rollNumber}`,
              ),
            },
          ];
        }),
      );
      const uniqueLinks = lastPerKey(links, (l) => `${l.rollcallId}|${l.billId}`);
      if (uniqueLinks.length > 0) {
        await tx
          .insert(rollcallBill)
          .values(uniqueLinks)
          .onConflictDoUpdate({
            target: [rollcallBill.rollcallId, rollcallBill.billId],
            set: conflictUpdateSet(rollcallBill),
          });
      }

      counts.add('bills', bills.length);
      counts.add('bill_policy_areas', areaRows.length);
      counts.add('bill_subjects', subjectRows.length);
      counts.add('rollcall_links', uniqueLinks.length);
      counts.add(
        'rollcall_links_final_passage',
        uniqueLinks.filter((l) => l.isFinalPassage).length,
      );
    });
  }

  // BILLSTATUS is the full record of the congress: drop child rows it no longer asserts.
  const congressBills = db.select({ id: bill.id }).from(bill).where(eq(bill.congress, congress));
  const deleted = await db.transaction(async (tx) => {
    const stale = <T extends typeof billSubject | typeof billPolicyArea | typeof rollcallBill>(
      t: T,
    ) =>
      and(
        eq(t.sourceId, ctx.sourceId),
        ne(t.ingestRunId, ctx.ingestRunId),
        inArray(t.billId, congressBills),
      );
    const a = await tx
      .delete(billSubject)
      .where(stale(billSubject))
      .returning({ id: billSubject.id });
    const b = await tx
      .delete(billPolicyArea)
      .where(stale(billPolicyArea))
      .returning({ id: billPolicyArea.id });
    const c = await tx
      .delete(rollcallBill)
      .where(stale(rollcallBill))
      .returning({ id: rollcallBill.id });
    return a.length + b.length + c.length;
  });
  counts.set('stale_rows_deleted', deleted);
  return counts.toJSON();
}
