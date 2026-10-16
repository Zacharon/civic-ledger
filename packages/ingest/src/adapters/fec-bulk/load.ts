import {
  candidacy,
  candidateCycleTotals,
  committee,
  committeeContribution,
  committeeLink,
  conflictUpdateSet,
  type Db,
  independentExpenditure,
  office,
  term,
} from '@civic-ledger/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { LoadContext, LoadCounts } from '../../adapter';
import { kindBatches, lastPerKey, ofKind, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { identifierMap, type OfficeKey, OfficeResolver } from '../lookups';
import type {
  CandidateRecord,
  CommitteeRecord,
  ContributionRecord,
  FecRecord,
  IeRecord,
  LinkRecord,
  StatsRecord,
  TotalsRecord,
} from './parse';

const COUNT_KEYS = [
  'committees',
  'candidates',
  'candidates_matched_to_person',
  'candidacies',
  'candidacies_presidential_skipped',
  'committee_links',
  'links_unknown_committee',
  'links_non_candidate_id',
  'totals',
  'totals_matched_to_person',
  'persons_with_several_fec_ids_in_cycle',
  'contributions',
  'contributions_matched_to_person',
  'contributions_recipient_via_committee',
  'contributions_unresolved_recipient',
  'contributions_unknown_committee',
  'pas2_rows',
  'pas2_excluded_type',
  'pas2_memo_dropped',
  'pas2_amendment_superseded',
  'pas2_duplicate_reports',
  'independent_expenditures',
  'ie_matched_to_person',
  'ie_rows',
  'ie_superseded_filings',
  'ie_duplicate_reports',
  'ie_invalid_support_oppose',
  'ie_implausible_amount_dropped',
  'ie_unattributed_dropped',
  'ie_candidate_ids_uppercased',
  'stale_rows_deleted',
] as const;
type FecCounts = Counts<(typeof COUNT_KEYS)[number]>;

interface State {
  ctx: LoadContext;
  cycle: number;
  counts: FecCounts;
  personByFec: Map<string, number>;
  committeeIds: Map<string, number>;
  /** cm CAND_ID: a principal/authorized committee's candidate. */
  committeeCandidate: Map<string, string>;
  /** ccl links for this cycle: committee → candidates. */
  cycleLinks: Map<string, Set<string>>;
  pendingTotals: TotalsRecord[];
  electionYear: Map<string, number | null>;
  offices: OfficeResolver;
}

/** Chamber of each person's latest term. */
async function currentChambers(db: Db): Promise<Map<number, string>> {
  const rows = await db
    .selectDistinctOn([term.personId], { personId: term.personId, chamber: office.chamber })
    .from(term)
    .innerJoin(office, eq(office.id, term.officeId))
    .orderBy(term.personId, desc(term.startDate));
  return new Map(rows.map((r) => [r.personId, r.chamber]));
}

const isCandidateId = (id: string) => /^[HSP][0-9A-Z]{8}$/.test(id);

export async function loadFec(
  records: AsyncIterable<FecRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  if (ctx.scope.kind !== 'cycle') throw new Error('fec-bulk needs a cycle scope');
  const s: State = {
    ctx,
    cycle: ctx.scope.cycle,
    counts: new Counts(COUNT_KEYS),
    personByFec: await identifierMap(ctx.db, 'fec_candidate'),
    committeeIds: new Map(),
    committeeCandidate: new Map(),
    cycleLinks: new Map(),
    pendingTotals: [],
    electionYear: new Map(),
    offices: new OfficeResolver(),
  };

  for await (const { kind, items } of kindBatches(records)) {
    if (kind !== 'totals' && s.pendingTotals.length > 0) await flushTotals(s);
    if (kind === 'committee') await loadCommittees(s, ofKind(items, 'committee'));
    if (kind === 'candidate') await loadCandidates(s, ofKind(items, 'candidate'));
    if (kind === 'link') await loadLinks(s, ofKind(items, 'link'));
    if (kind === 'totals') s.pendingTotals.push(...ofKind(items, 'totals'));
    if (kind === 'contribution') await loadContributions(s, ofKind(items, 'contribution'));
    if (kind === 'ie') await loadExpenditures(s, ofKind(items, 'ie'));
    if (kind === 'stats') for (const stats of ofKind(items, 'stats')) recordStats(s, stats);
  }
  if (s.pendingTotals.length > 0) await flushTotals(s);
  await deleteStaleCycleRows(s);
  return s.counts.toJSON();
}

async function loadCommittees(s: State, rows: CommitteeRecord[]) {
  const values = lastPerKey(rows, (r) => r.id).map((r) => ({
    fecCommitteeId: r.id,
    name: r.name,
    committeeType: r.type,
    designation: r.designation,
    party: r.party,
    organizationType: r.orgType,
    connectedOrganization: r.connectedOrg,
    ...provenance(s.ctx, `cm:${r.id}`),
  }));
  const inserted = await s.ctx.db.transaction((tx) =>
    tx
      .insert(committee)
      .values(values)
      .onConflictDoUpdate({ target: committee.fecCommitteeId, set: conflictUpdateSet(committee) })
      .returning({ id: committee.id, fecId: committee.fecCommitteeId }),
  );
  for (const c of inserted) s.committeeIds.set(c.fecId, c.id);
  for (const r of rows) if (r.candidateId) s.committeeCandidate.set(r.id, r.candidateId);
  s.counts.add('committees', values.length);
}

/** House district: FEC "00" (at-large) → 0. Senate seats have no district. */
function officeOf(r: CandidateRecord): OfficeKey | null {
  if (!r.state || (r.office !== 'H' && r.office !== 'S')) return null;
  return r.office === 'S'
    ? { chamber: 'senate', state: r.state, district: null }
    : { chamber: 'house', state: r.state, district: r.district ?? 0 };
}

async function loadCandidates(s: State, rows: CandidateRecord[]) {
  s.counts.add('candidates', rows.length);
  for (const r of rows) s.electionYear.set(r.id, r.electionYear);
  const matched = rows.flatMap((r) => {
    const personId = s.personByFec.get(r.id);
    return personId === undefined ? [] : [{ r, personId }];
  });
  s.counts.add('candidates_matched_to_person', matched.length);
  const withOffice = matched.flatMap(({ r, personId }) => {
    const key = officeOf(r);
    if (!key || r.electionYear === null) {
      if (r.office === 'P') s.counts.add('candidacies_presidential_skipped');
      return [];
    }
    return [{ r, personId, key, electionYear: r.electionYear }];
  });
  if (withOffice.length === 0) return;
  await s.ctx.db.transaction(async (tx) => {
    await s.offices.resolve(
      tx,
      withOffice.map((w) => w.key),
    );
    const values = lastPerKey(
      withOffice.map(({ r, personId, key, electionYear }) => ({
        personId,
        cycle: electionYear,
        officeId: s.offices.idFor(key),
        fecCandidateId: r.id,
        party: r.party ?? 'Unknown',
        outcome: null,
        ...provenance(s.ctx, `cn:${r.id}`),
      })),
      (v) => `${v.personId}|${v.cycle}|${v.officeId}`,
    );
    await tx
      .insert(candidacy)
      .values(values)
      .onConflictDoUpdate({
        target: [candidacy.personId, candidacy.cycle, candidacy.officeId],
        set: conflictUpdateSet(candidacy),
      });
    s.counts.add('candidacies', values.length);
  });
}

async function loadLinks(s: State, rows: LinkRecord[]) {
  const values: (typeof committeeLink.$inferInsert)[] = [];
  for (const r of rows) {
    if (!isCandidateId(r.candidateId)) {
      s.counts.add('links_non_candidate_id');
      continue;
    }
    const committeeId = s.committeeIds.get(r.committeeId);
    if (committeeId === undefined) {
      s.counts.add('links_unknown_committee');
      continue;
    }
    if (r.fecElectionYear === s.cycle) {
      s.cycleLinks.set(
        r.committeeId,
        (s.cycleLinks.get(r.committeeId) ?? new Set()).add(r.candidateId),
      );
    }
    values.push({
      fecCandidateId: r.candidateId,
      committeeId,
      cycle: r.fecElectionYear,
      designation: r.designation,
      ...provenance(s.ctx, `ccl:${r.candidateId}:${r.committeeId}:${r.fecElectionYear}`),
    });
  }
  const unique = lastPerKey(values, (v) => `${v.fecCandidateId}|${v.committeeId}|${v.cycle}`);
  if (unique.length === 0) return;
  await s.ctx.db.transaction((tx) =>
    tx
      .insert(committeeLink)
      .values(unique)
      .onConflictDoUpdate({
        target: [committeeLink.fecCandidateId, committeeLink.committeeId, committeeLink.cycle],
        set: conflictUpdateSet(committeeLink),
      }),
  );
  s.counts.add('committee_links', unique.length);
}

export interface AttributionContext {
  cycle: number;
  /** cn CAND_ELECTION_YR per candidate id. */
  electionYear: ReadonlyMap<string, number | null>;
  /** Chamber of each person's latest term ('house' | 'senate'). */
  currentChamber: ReadonlyMap<number, string>;
}

/**
 * A person can hold several FEC candidate ids (a House and a Senate run), and weball often
 * repeats the same totals under each. Exactly one totals row per person and cycle is
 * attributed to the person, ranked: 1. the id is on this cycle's ballot (cn election year
 * = cycle); 2. most receipts (the active campaign); 3. the id's office (first letter H/S)
 * matches the person's current chamber; 4. lowest id. The others stay queryable by FEC id.
 */
export function attributeTotals(
  rows: readonly TotalsRecord[],
  personByFec: ReadonlyMap<string, number>,
  ctx: AttributionContext,
): { attributed: Map<string, number>; personsWithSeveral: number } {
  const rank = (r: TotalsRecord, personId: number): (number | string)[] => {
    const chamber = ctx.currentChamber.get(personId);
    const office = r.candidateId.startsWith('S')
      ? 'senate'
      : r.candidateId.startsWith('H')
        ? 'house'
        : null;
    return [
      ctx.electionYear.get(r.candidateId) === ctx.cycle ? 1 : 0,
      r.totalReceiptsCents,
      office !== null && office === chamber ? 1 : 0,
    ];
  };
  const better = (a: TotalsRecord, b: TotalsRecord, personId: number): boolean => {
    const ra = rank(a, personId);
    const rb = rank(b, personId);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return (ra[i] ?? 0) > (rb[i] ?? 0);
    }
    return a.candidateId < b.candidateId;
  };
  const best = new Map<number, TotalsRecord>();
  const seen = new Map<number, number>();
  for (const r of rows) {
    const personId = personByFec.get(r.candidateId);
    if (personId === undefined) continue;
    seen.set(personId, (seen.get(personId) ?? 0) + 1);
    const current = best.get(personId);
    if (!current || better(r, current, personId)) best.set(personId, r);
  }
  const attributed = new Map<string, number>();
  for (const [personId, r] of best) attributed.set(r.candidateId, personId);
  return { attributed, personsWithSeveral: [...seen.values()].filter((n) => n > 1).length };
}

async function flushTotals(s: State) {
  const rows = lastPerKey(s.pendingTotals, (r) => r.candidateId);
  s.pendingTotals = [];
  const { attributed, personsWithSeveral } = attributeTotals(rows, s.personByFec, {
    cycle: s.cycle,
    electionYear: s.electionYear,
    currentChamber: await currentChambers(s.ctx.db),
  });
  s.counts.add('persons_with_several_fec_ids_in_cycle', personsWithSeveral);
  for (let i = 0; i < rows.length; i += 1_000) {
    const values = rows.slice(i, i + 1_000).map((r) => ({
      fecCandidateId: r.candidateId,
      cycle: s.cycle,
      personId: attributed.get(r.candidateId) ?? null,
      totalReceiptsCents: r.totalReceiptsCents,
      individualCents: r.individualCents,
      // weball has no itemized/unitemized split: null = no data, never a guessed share.
      unitemizedIndividualCents: null,
      otherCommitteeCents: r.otherCommitteeCents,
      partyCents: r.partyCents,
      candidateSelfCents: r.candidateSelfCents,
      totalDisbursementsCents: r.totalDisbursementsCents,
      cashOnHandCents: r.cashOnHandCents,
      debtsCents: r.debtsCents,
      coverageEndDate: r.coverageEndDate,
      ...provenance(s.ctx, `weball:${r.candidateId}:${s.cycle}`),
    }));
    await s.ctx.db.transaction((tx) =>
      tx
        .insert(candidateCycleTotals)
        .values(values)
        .onConflictDoUpdate({
          target: [candidateCycleTotals.fecCandidateId, candidateCycleTotals.cycle],
          set: conflictUpdateSet(candidateCycleTotals),
        }),
    );
  }
  s.counts.add('totals', rows.length);
  s.counts.add('totals_matched_to_person', attributed.size);
}

/** pas2 recipient: CAND_ID, else the recipient committee (OTHER_ID) → its one candidate. */
export function resolveRecipient(
  r: Pick<ContributionRecord, 'candidateId' | 'otherId'>,
  cycleLinks: ReadonlyMap<string, ReadonlySet<string>>,
  committeeCandidate: ReadonlyMap<string, string>,
): { candidateId: string; viaCommittee: boolean } | null {
  if (r.candidateId) return { candidateId: r.candidateId, viaCommittee: false };
  if (!r.otherId) return null;
  const linked = cycleLinks.get(r.otherId);
  if (linked && linked.size > 1) return null; // joint committee: no single recipient
  const [only] = linked ?? [];
  if (only) return { candidateId: only, viaCommittee: true };
  const fromCm = committeeCandidate.get(r.otherId);
  return fromCm ? { candidateId: fromCm, viaCommittee: true } : null;
}

async function loadContributions(s: State, rows: ContributionRecord[]) {
  const values: (typeof committeeContribution.$inferInsert)[] = [];
  for (const r of rows) {
    const committeeId = s.committeeIds.get(r.committeeId);
    if (committeeId === undefined) {
      s.counts.add('contributions_unknown_committee');
      continue;
    }
    const recipient = resolveRecipient(r, s.cycleLinks, s.committeeCandidate);
    if (!recipient) {
      s.counts.add('contributions_unresolved_recipient');
      continue;
    }
    if (recipient.viaCommittee) s.counts.add('contributions_recipient_via_committee');
    const personId = s.personByFec.get(recipient.candidateId) ?? null;
    if (personId !== null) s.counts.add('contributions_matched_to_person');
    values.push({
      fecSubId: r.subId,
      committeeId,
      recipientFecCandidateId: recipient.candidateId,
      personId,
      cycle: s.cycle,
      amountCents: r.amountCents,
      transactionDate: r.date,
      transactionType: r.transactionType,
      ...provenance(s.ctx, `pas2:${r.subId}`),
    });
  }
  if (values.length === 0) return;
  await s.ctx.db.transaction((tx) =>
    tx
      .insert(committeeContribution)
      .values(values)
      .onConflictDoUpdate({
        target: committeeContribution.fecSubId,
        set: conflictUpdateSet(committeeContribution),
      }),
  );
  s.counts.add('contributions', values.length);
}

async function loadExpenditures(s: State, rows: IeRecord[]) {
  const values: (typeof independentExpenditure.$inferInsert)[] = [];
  for (const r of rows) {
    if (!r.candidateId) {
      s.counts.add('ie_unattributed_dropped');
      continue;
    }
    const personId = s.personByFec.get(r.candidateId) ?? null;
    if (personId !== null) s.counts.add('ie_matched_to_person');
    values.push({
      spenderFecCommitteeId: r.spenderId,
      fecTransactionId: r.transactionKey,
      spenderCommitteeId: s.committeeIds.get(r.spenderId) ?? null,
      spenderName: r.spenderName,
      candidateFecId: r.candidateId,
      personId,
      supportOppose: r.supportOppose,
      cycle: s.cycle,
      amountCents: r.amountCents,
      expenditureDate: r.date,
      purpose: r.purpose,
      ...provenance(s.ctx, `ie:${r.spenderId}:${r.transactionKey}`),
    });
  }
  const unique = lastPerKey(values, (v) => `${v.spenderFecCommitteeId}|${v.fecTransactionId}`);
  if (unique.length === 0) return;
  await s.ctx.db.transaction((tx) =>
    tx
      .insert(independentExpenditure)
      .values(unique)
      .onConflictDoUpdate({
        target: [
          independentExpenditure.spenderFecCommitteeId,
          independentExpenditure.fecTransactionId,
        ],
        set: conflictUpdateSet(independentExpenditure),
      }),
  );
  s.counts.add('independent_expenditures', unique.length);
}

function recordStats(s: State, stats: StatsRecord) {
  if (stats.pas2) {
    s.counts.add('pas2_rows', stats.pas2.rows);
    s.counts.add('pas2_excluded_type', stats.pas2.excludedType);
    s.counts.add('pas2_memo_dropped', stats.pas2.memoDropped);
    s.counts.add('pas2_amendment_superseded', stats.pas2.amendmentSuperseded);
    s.counts.add('pas2_duplicate_reports', stats.pas2.duplicateReports);
  }
  if (stats.ie) {
    s.counts.add('ie_rows', stats.ie.rows);
    s.counts.add('ie_superseded_filings', stats.ie.superseded);
    s.counts.add('ie_duplicate_reports', stats.ie.duplicateReports);
    s.counts.add('ie_invalid_support_oppose', stats.ie.invalidSupportOppose);
    s.counts.add('ie_implausible_amount_dropped', stats.ie.implausibleAmount);
    s.counts.add('ie_candidate_ids_uppercased', stats.ie.normalizedCandidateIds);
  }
}

/**
 * The bulk files are the complete record for the cycle, so this cycle's money rows not
 * re-asserted by this run (superseded by an amendment since the last load) are removed.
 * Runs only after every batch loaded; a failed run leaves the previous rows in place.
 */
async function deleteStaleCycleRows(s: State) {
  const { db, ingestRunId, sourceId } = s.ctx;
  const stale = (
    table:
      | typeof committeeContribution
      | typeof independentExpenditure
      | typeof candidateCycleTotals
      | typeof committeeLink,
  ) =>
    and(eq(table.sourceId, sourceId), eq(table.cycle, s.cycle), ne(table.ingestRunId, ingestRunId));
  const deleted = await db.transaction(async (tx: Db) => {
    const a = await tx
      .delete(committeeContribution)
      .where(stale(committeeContribution))
      .returning({ id: committeeContribution.id });
    const b = await tx
      .delete(independentExpenditure)
      .where(stale(independentExpenditure))
      .returning({ id: independentExpenditure.id });
    const c = await tx
      .delete(candidateCycleTotals)
      .where(stale(candidateCycleTotals))
      .returning({ id: candidateCycleTotals.id });
    const d = await tx
      .delete(committeeLink)
      .where(stale(committeeLink))
      .returning({ id: committeeLink.id });
    return a.length + b.length + c.length + d.length;
  });
  s.counts.set('stale_rows_deleted', deleted);
}
