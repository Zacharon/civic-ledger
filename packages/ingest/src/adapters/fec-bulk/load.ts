import {
  candidacy,
  candidateCycleSummary,
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
import {
  type CandidateRecord,
  type CommitteeRecord,
  type ContributionRecord,
  contributionFromPas2,
  expenditureFromRow,
  type FecRecord,
  type IeRecord,
  type LinkRecord,
  type StatsRecord,
  type SummaryRecord,
  type TotalsRecord,
} from './parse';
import {
  createIeStage,
  createPas2Stage,
  dedupeStagedIe,
  dedupeStagedPas2,
  dropIeStage,
  dropPas2Stage,
  keptIePages,
  keptPas2Pages,
  stageIe,
  stagePas2,
} from './stage';

/** Tables the cycle sweep deletes from, with their loaded and per-table sweep counters. */
export const SWEPT_CYCLE_TABLES = [
  {
    table: 'committee_contribution',
    loaded: 'contributions',
    swept: 'stale_contributions_deleted',
  },
  {
    table: 'independent_expenditure',
    loaded: 'independent_expenditures',
    swept: 'stale_independent_expenditures_deleted',
  },
  { table: 'candidate_cycle_totals', loaded: 'totals', swept: 'stale_totals_deleted' },
  { table: 'committee_link', loaded: 'committee_links', swept: 'stale_committee_links_deleted' },
  { table: 'candidate_cycle_summary', loaded: 'summaries', swept: 'stale_summaries_deleted' },
] as const;

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
  'summaries',
  'summaries_matched_to_person',
  'summaries_attributed_via_other_id',
  'summary_unitemized_out_of_range',
  'summary_period_differs_from_totals',
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
  'stale_contributions_deleted',
  'stale_independent_expenditures_deleted',
  'stale_totals_deleted',
  'stale_committee_links_deleted',
  'stale_summaries_deleted',
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
  pendingSummaries: SummaryRecord[];
  /** weball candidate id → person it was attributed to, and its coverage end date. */
  attributedTotals: Map<string, { personId: number; coverageEndDate: string | null }>;
  electionYear: Map<string, number | null>;
  offices: OfficeResolver;
  pas2Staged: boolean;
  ieStaged: boolean;
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
  checkpoint(ctx);
  const s: State = {
    ctx,
    cycle: ctx.scope.cycle,
    counts: new Counts(COUNT_KEYS),
    personByFec: await identifierMap(ctx.db, 'fec_candidate'),
    committeeIds: new Map(),
    committeeCandidate: new Map(),
    cycleLinks: new Map(),
    pendingTotals: [],
    pendingSummaries: [],
    attributedTotals: new Map(),
    electionYear: new Map(),
    offices: new OfficeResolver(),
    pas2Staged: false,
    ieStaged: false,
  };

  for await (const { kind, items } of kindBatches(records)) {
    checkpoint(ctx);
    if (kind !== 'totals' && s.pendingTotals.length > 0) await flushTotals(s);
    if (kind === 'committee') await loadCommittees(s, ofKind(items, 'committee'));
    if (kind === 'candidate') await loadCandidates(s, ofKind(items, 'candidate'));
    if (kind === 'link') await loadLinks(s, ofKind(items, 'link'));
    if (kind === 'totals') s.pendingTotals.push(...ofKind(items, 'totals'));
    if (kind !== 'summary' && s.pendingSummaries.length > 0) await flushSummaries(s);
    if (kind === 'summary') s.pendingSummaries.push(...ofKind(items, 'summary'));
    if (kind !== 'pas2_row' && s.pas2Staged) await flushPas2(s);
    if (kind === 'pas2_row') await stagePas2Rows(s, ofKind(items, 'pas2_row'));
    if (kind !== 'ie_row' && s.ieStaged) await flushIe(s);
    if (kind === 'ie_row') await stageIeRows(s, ofKind(items, 'ie_row'));
    if (kind === 'stats') for (const stats of ofKind(items, 'stats')) recordStats(s, stats);
  }
  if (s.pendingTotals.length > 0) await flushTotals(s);
  if (s.pendingSummaries.length > 0) await flushSummaries(s);
  if (s.pas2Staged) await flushPas2(s);
  if (s.ieStaged) await flushIe(s);
  checkpoint(ctx);
  await deleteStaleCycleRows(s);
  return s.counts.toJSON();
}

/**
 * Cancellation checkpoint (DECISIONS A52, H3R2-02, H3R3). This loader calls it before
 * every statement it issues (in this file and `stage.ts`: each `execute` and query-builder
 * statement, including between a stage DROP and CREATE and before each sweep DELETE) and
 * as the first step of every savepoint callback (`savepoint`). So once an abort, the
 * deadline or a lost lock is visible, the loader starts no further statement of its own;
 * a statement already running finishes first. Not covered: the SAVEPOINT / RELEASE /
 * ROLLBACK TO SAVEPOINT statements the driver issues around a callback.
 */
function checkpoint(ctx: LoadContext): void {
  if (ctx.checkpoint) ctx.checkpoint();
  else ctx.signal?.throwIfAborted();
}

/**
 * A savepoint (nested transaction) whose callback starts at a checkpoint: the driver
 * awaits its SAVEPOINT statement before calling `work`, and an abort seen during that
 * round trip must stop the load before the callback's first statement.
 */
function savepoint<T>(s: State, work: (tx: Db) => Promise<T> | PromiseLike<T>): Promise<T> {
  checkpoint(s.ctx);
  return s.ctx.db.transaction(async (tx: Db) => {
    checkpoint(s.ctx);
    return work(tx);
  });
}

async function stagePas2Rows(s: State, rows: Parameters<typeof stagePas2>[1]) {
  checkpoint(s.ctx);
  if (!s.pas2Staged) await createPas2Stage(s.ctx.db, () => checkpoint(s.ctx));
  s.pas2Staged = true;
  checkpoint(s.ctx);
  await stagePas2(s.ctx.db, rows);
}

/**
 * Dedupes the staged pas2 rows in SQL and loads the kept ones one page at a time, with a
 * cancellation checkpoint before every statement. A cancelled flush leaves the stage
 * tables to the rollback of the load transaction, which removes them.
 */
async function flushPas2(s: State) {
  s.pas2Staged = false;
  const check = () => checkpoint(s.ctx);
  const stats = await dedupeStagedPas2(s.ctx.db, check);
  s.counts.add('pas2_amendment_superseded', stats.amendmentSuperseded);
  s.counts.add('pas2_duplicate_reports', stats.duplicateReports);
  for await (const page of keptPas2Pages(s.ctx.db, check)) {
    check();
    await loadContributions(s, page.map(contributionFromPas2));
  }
  check();
  await dropPas2Stage(s.ctx.db);
}

async function stageIeRows(s: State, rows: Parameters<typeof stageIe>[1]) {
  checkpoint(s.ctx);
  if (!s.ieStaged) await createIeStage(s.ctx.db, () => checkpoint(s.ctx));
  s.ieStaged = true;
  checkpoint(s.ctx);
  await stageIe(s.ctx.db, rows);
}

/** As `flushPas2`, for the staged independent expenditures. */
async function flushIe(s: State) {
  s.ieStaged = false;
  const check = () => checkpoint(s.ctx);
  const stats = await dedupeStagedIe(s.ctx.db, check);
  s.counts.add('ie_superseded_filings', stats.superseded);
  s.counts.add('ie_duplicate_reports', stats.duplicateReports);
  s.counts.add('ie_invalid_support_oppose', stats.invalidSupportOppose);
  s.counts.add('ie_implausible_amount_dropped', stats.implausibleAmount);
  for await (const page of keptIePages(s.ctx.db, check)) {
    check();
    await loadExpenditures(s, page.map(expenditureFromRow));
  }
  check();
  await dropIeStage(s.ctx.db);
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
  const inserted = await savepoint(s, (tx) =>
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
  await savepoint(s, async (tx) => {
    await s.offices.resolve(
      tx,
      withOffice.map((w) => w.key),
    );
    checkpoint(s.ctx);
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
  await savepoint(s, (tx) =>
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
  checkpoint(s.ctx);
  const { attributed, personsWithSeveral } = attributeTotals(rows, s.personByFec, {
    cycle: s.cycle,
    electionYear: s.electionYear,
    currentChamber: await currentChambers(s.ctx.db),
  });
  s.counts.add('persons_with_several_fec_ids_in_cycle', personsWithSeveral);
  for (let i = 0; i < rows.length; i += 1_000) {
    checkpoint(s.ctx);
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
    await savepoint(s, (tx) =>
      tx
        .insert(candidateCycleTotals)
        .values(values)
        .onConflictDoUpdate({
          target: [candidateCycleTotals.fecCandidateId, candidateCycleTotals.cycle],
          set: conflictUpdateSet(candidateCycleTotals),
        }),
    );
  }
  for (const r of rows) {
    const personId = attributed.get(r.candidateId);
    if (personId !== undefined) {
      s.attributedTotals.set(r.candidateId, { personId, coverageEndDate: r.coverageEndDate });
    }
  }
  s.counts.add('totals', rows.length);
  s.counts.add('totals_matched_to_person', attributed.size);
}

/**
 * Picks one candidate summary row per person: the row for the weball id attributed to the
 * person (A15) when the summary has it, else the person's row with the most receipts (the
 * summary file can list a different id, e.g. a Senate run, than the one weball totals were
 * attributed to). The others stay queryable by FEC id with person_id null.
 */
export function attributeSummaries(
  rows: readonly SummaryRecord[],
  personByFec: ReadonlyMap<string, number>,
  attributedTotals: ReadonlyMap<string, { personId: number }>,
): { attributed: Map<string, number>; viaOtherId: number } {
  const preferred = (a: SummaryRecord, b: SummaryRecord): boolean => {
    const aAttributed = attributedTotals.has(a.candidateId);
    if (aAttributed !== attributedTotals.has(b.candidateId)) return aAttributed;
    if (a.totalReceiptsCents !== b.totalReceiptsCents) {
      return a.totalReceiptsCents > b.totalReceiptsCents;
    }
    return a.candidateId < b.candidateId;
  };
  const best = new Map<number, SummaryRecord>();
  for (const r of rows) {
    const personId = personByFec.get(r.candidateId);
    if (personId === undefined) continue;
    const current = best.get(personId);
    if (!current || preferred(r, current)) best.set(personId, r);
  }
  const attributed = new Map<string, number>();
  let viaOtherId = 0;
  for (const [personId, r] of best) {
    attributed.set(r.candidateId, personId);
    if (!attributedTotals.has(r.candidateId)) viaOtherId++;
  }
  return { attributed, viaOtherId };
}

/**
 * Candidate summary rows, stored as filed. person_card ignores an unitemized amount outside
 * [0, total receipts]; such rows are counted (about ten filer errors in the 2026 file).
 */
async function flushSummaries(s: State) {
  const rows = lastPerKey(s.pendingSummaries, (r) => r.candidateId);
  s.pendingSummaries = [];
  const { attributed, viaOtherId } = attributeSummaries(rows, s.personByFec, s.attributedTotals);
  s.counts.add('summaries_attributed_via_other_id', viaOtherId);
  const values = rows.map((r) => {
    const personId = attributed.get(r.candidateId) ?? null;
    const totals = s.attributedTotals.get(r.candidateId);
    if (personId !== null && totals && totals.coverageEndDate !== r.coverageEndDate) {
      s.counts.add('summary_period_differs_from_totals');
    }
    const inRange =
      r.unitemizedIndividualCents >= 0 && r.unitemizedIndividualCents <= r.totalReceiptsCents;
    if (!inRange) s.counts.add('summary_unitemized_out_of_range');
    return {
      fecCandidateId: r.candidateId,
      cycle: s.cycle,
      personId,
      totalReceiptsCents: r.totalReceiptsCents,
      individualCents: r.individualCents,
      itemizedIndividualCents: r.itemizedIndividualCents,
      unitemizedIndividualCents: r.unitemizedIndividualCents,
      coverageEndDate: r.coverageEndDate,
      ...provenance(s.ctx, `candidate_summary:${r.candidateId}:${s.cycle}`),
    };
  });
  for (let i = 0; i < values.length; i += 1_000) {
    checkpoint(s.ctx);
    const chunk = values.slice(i, i + 1_000);
    await savepoint(s, (tx) =>
      tx
        .insert(candidateCycleSummary)
        .values(chunk)
        .onConflictDoUpdate({
          target: [candidateCycleSummary.fecCandidateId, candidateCycleSummary.cycle],
          set: conflictUpdateSet(candidateCycleSummary),
        }),
    );
  }
  s.counts.add('summaries', values.length);
  s.counts.add('summaries_matched_to_person', attributed.size);
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
  await savepoint(s, (tx) =>
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
  await savepoint(s, (tx) =>
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
  }
  if (stats.ie) {
    s.counts.add('ie_rows', stats.ie.rows);
    s.counts.add('ie_candidate_ids_uppercased', stats.ie.normalizedCandidateIds);
  }
}

/**
 * The bulk files are the complete record for the cycle, so this cycle's money rows not
 * re-asserted by this run (superseded by an amendment since the last load) are removed.
 * Runs only after every batch loaded; a failed run leaves the previous rows in place.
 * One savepoint, five DELETEs, a checkpoint before each (H3R3): an abort seen after one
 * DELETE stops the sweep before the next, and the load transaction rolls all back.
 */
async function deleteStaleCycleRows(s: State) {
  const { ingestRunId, sourceId } = s.ctx;
  const check = () => checkpoint(s.ctx);
  const stale = (
    table:
      | typeof committeeContribution
      | typeof independentExpenditure
      | typeof candidateCycleTotals
      | typeof candidateCycleSummary
      | typeof committeeLink,
  ) =>
    and(eq(table.sourceId, sourceId), eq(table.cycle, s.cycle), ne(table.ingestRunId, ingestRunId));
  // Per-table counters let the shrink guard judge each table on its own (DECISIONS A51).
  await savepoint(s, async (tx: Db) => {
    check();
    const a = await tx
      .delete(committeeContribution)
      .where(stale(committeeContribution))
      .returning({ id: committeeContribution.id });
    check();
    const b = await tx
      .delete(independentExpenditure)
      .where(stale(independentExpenditure))
      .returning({ id: independentExpenditure.id });
    check();
    const c = await tx
      .delete(candidateCycleTotals)
      .where(stale(candidateCycleTotals))
      .returning({ id: candidateCycleTotals.id });
    check();
    const d = await tx
      .delete(committeeLink)
      .where(stale(committeeLink))
      .returning({ id: committeeLink.id });
    check();
    const e = await tx
      .delete(candidateCycleSummary)
      .where(stale(candidateCycleSummary))
      .returning({ id: candidateCycleSummary.id });
    s.counts.set('stale_contributions_deleted', a.length);
    s.counts.set('stale_independent_expenditures_deleted', b.length);
    s.counts.set('stale_totals_deleted', c.length);
    s.counts.set('stale_committee_links_deleted', d.length);
    s.counts.set('stale_summaries_deleted', e.length);
    s.counts.set('stale_rows_deleted', a.length + b.length + c.length + d.length + e.length);
  });
}
