import { and, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { refreshPersonCard } from '../read-model';
import * as s from '../schema';
import { conflictUpdateSet } from '../upsert';
import { SEED_INDUSTRIES, SEED_POLICY_AREAS, SEED_PUBLISHERS } from './catalog';
import { buildSeedData, SEED_CONGRESS, type SeedData } from './fixtures';

export const DEV_SEED_SOURCE_ID = 'dev-seed';
export const DEV_SEED_VERSION = 'dev-seed@1';
const RETRIEVED_AT = new Date('2026-10-01T00:00:00Z');
const EXAMPLE = 'https://example.org/dev-seed';

type Provenance = (sourceKey: string) => {
  sourceId: string;
  sourceKey: string;
  ingestRunId: number;
  retrievedAt: Date;
};

export interface SeedResult {
  ingestRunId: number;
  counts: Record<string, number>;
}

/**
 * Loads the fictional development dataset. Idempotent: rows upsert on natural keys and
 * the run ledger row is reused (same source + version + checksum), as ingest dedupe does.
 */
export async function seedDevData(db: Db): Promise<SeedResult> {
  const data = buildSeedData();
  await db
    .insert(s.source)
    .values({
      id: DEV_SEED_SOURCE_ID,
      name: 'Development seed (fictional data)',
      url: EXAMPLE,
      license: 'Invented sample data for local development. Not about any real person.',
      description: 'Fictional people, money, votes and scores used to exercise the app.',
    })
    .onConflictDoUpdate({ target: s.source.id, set: conflictUpdateSet(s.source) });

  const ingestRunId = await findOrStartRun(db);
  const provenance: Provenance = (sourceKey) => ({
    sourceId: DEV_SEED_SOURCE_ID,
    sourceKey,
    ingestRunId,
    retrievedAt: RETRIEVED_AT,
  });
  const counts = await db.transaction((tx) => loadAll(tx, data, provenance));
  await refreshPersonCard(db);
  await db
    .update(s.ingestRun)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      counts,
      readModelRefreshedAfter: new Date(),
    })
    .where(eq(s.ingestRun.id, ingestRunId));
  return { ingestRunId, counts };
}

async function findOrStartRun(db: Db): Promise<number> {
  const [existing] = await db
    .select({ id: s.ingestRun.id })
    .from(s.ingestRun)
    .where(
      and(
        eq(s.ingestRun.sourceId, DEV_SEED_SOURCE_ID),
        eq(s.ingestRun.adapterVersion, DEV_SEED_VERSION),
        eq(s.ingestRun.snapshotChecksum, DEV_SEED_VERSION),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(s.ingestRun)
    .values({
      sourceId: DEV_SEED_SOURCE_ID,
      adapterVersion: DEV_SEED_VERSION,
      scope: 'all',
      snapshotChecksum: DEV_SEED_VERSION,
    })
    .returning({ id: s.ingestRun.id });
  if (!created) throw new Error('Failed to create the dev-seed ingest run');
  return created.id;
}

async function loadAll(
  db: Db,
  data: SeedData,
  provenance: Provenance,
): Promise<Record<string, number>> {
  await loadVocabularies(db, provenance);
  const personIds = await loadPeople(db, data, provenance);
  await loadMoney(db, data, personIds, provenance);
  const votes = await loadLegislation(db, data, personIds, provenance);
  await loadScores(db, data, personIds, provenance);
  await loadCurated(db, data, personIds, votes, provenance);
  return {
    people: data.people.length,
    terms: data.terms.length,
    committees: data.committees.length,
    contributions: data.contributions.length,
    outsideSpending: data.outsideSpending.length,
    bills: data.bills.length,
    rollcalls: data.rollcalls.length,
    votePositions: data.rollcalls.reduce((n, r) => n + r.positions.length, 0),
    scorecardScores: data.scores.length,
    promises: data.promises.length,
    platformPositions: data.platforms.length,
    frameworks: data.frameworks.length,
  };
}

async function loadVocabularies(db: Db, provenance: Provenance): Promise<void> {
  await db
    .insert(s.policyArea)
    .values([...SEED_POLICY_AREAS])
    .onConflictDoUpdate({ target: s.policyArea.id, set: conflictUpdateSet(s.policyArea) });
  await db
    .insert(s.industry)
    .values(SEED_INDUSTRIES.map((i) => ({ ...i, ...provenance(`industry:${i.id}`) })))
    .onConflictDoUpdate({ target: s.industry.id, set: conflictUpdateSet(s.industry) });
  await db
    .insert(s.scorecardPublisher)
    .values(
      SEED_PUBLISHERS.map((p) => ({
        id: p.id,
        name: p.name,
        selfDescribedOrientation: p.selfDescribedOrientation,
        termsStatus: p.termsStatus,
        url: `${EXAMPLE}/publishers/${p.id}`,
        methodologyUrl: `${EXAMPLE}/publishers/${p.id}/methodology`,
        ...provenance(`publisher:${p.id}`),
      })),
    )
    .onConflictDoUpdate({
      target: s.scorecardPublisher.id,
      set: conflictUpdateSet(s.scorecardPublisher),
    });
}

const officeKey = (o: { chamber: string; state: string; district: number | null }) =>
  `${o.chamber}|${o.state}|${o.district ?? ''}`;

function required<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed reference not found: ${String(key)}`);
  return value;
}

async function loadPeople(
  db: Db,
  data: SeedData,
  provenance: Provenance,
): Promise<Map<string, number>> {
  const people = await db
    .insert(s.person)
    .values(
      data.people.map((p) => ({
        slug: p.slug,
        fullName: `${p.firstName} ${p.lastName}`,
        firstName: p.firstName,
        lastName: p.lastName,
        ...provenance(`person:${p.bioguide}`),
      })),
    )
    .onConflictDoUpdate({ target: s.person.slug, set: conflictUpdateSet(s.person) })
    .returning({ id: s.person.id, slug: s.person.slug });
  const personIds = new Map(people.map((p) => [p.slug, p.id]));

  await db
    .insert(s.personIdentifier)
    .values(
      data.people.flatMap((p) => {
        const personId = required(personIds, p.slug);
        return (
          [
            ['bioguide', p.bioguide],
            ['icpsr', p.icpsr],
            ['fec_candidate', p.fecCandidateId],
          ] as const
        ).map(([scheme, value]) => ({
          personId,
          scheme,
          value,
          ...provenance(`${scheme}:${value}`),
        }));
      }),
    )
    .onConflictDoUpdate({
      target: [s.personIdentifier.scheme, s.personIdentifier.value],
      set: conflictUpdateSet(s.personIdentifier),
    });

  const seats = new Map(
    [...data.terms, ...data.candidacies].map((t) => [
      officeKey(t),
      { level: 'federal' as const, chamber: t.chamber, state: t.state, district: t.district },
    ]),
  );
  const offices = await db
    .insert(s.office)
    .values([...seats.values()])
    .onConflictDoUpdate({
      target: [s.office.level, s.office.chamber, s.office.state, s.office.district],
      set: conflictUpdateSet(s.office),
    })
    .returning();
  const officeIds = new Map(offices.map((o) => [officeKey(o), o.id]));

  await db
    .insert(s.term)
    .values(
      data.terms.map((t) => ({
        personId: required(personIds, t.slug),
        officeId: required(officeIds, officeKey(t)),
        party: t.party,
        startDate: t.startDate,
        endDate: t.endDate,
        ...provenance(`term:${t.slug}:${t.startDate}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.term.personId, s.term.officeId, s.term.startDate],
      set: conflictUpdateSet(s.term),
    });

  await db
    .insert(s.candidacy)
    .values(
      data.candidacies.map((c) => ({
        personId: required(personIds, c.slug),
        cycle: c.cycle,
        officeId: required(officeIds, officeKey(c)),
        fecCandidateId: c.fecCandidateId,
        party: c.party,
        outcome: c.outcome,
        ...provenance(`candidacy:${c.slug}:${c.cycle}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.candidacy.personId, s.candidacy.cycle, s.candidacy.officeId],
      set: conflictUpdateSet(s.candidacy),
    });
  return personIds;
}

async function loadMoney(
  db: Db,
  data: SeedData,
  personIds: Map<string, number>,
  provenance: Provenance,
): Promise<void> {
  const committees = await db
    .insert(s.committee)
    .values(
      data.committees.map((c) => ({
        fecCommitteeId: c.fecCommitteeId,
        name: c.name,
        committeeType: c.committeeType,
        designation: c.designation,
        ...provenance(`committee:${c.fecCommitteeId}`),
      })),
    )
    .onConflictDoUpdate({ target: s.committee.fecCommitteeId, set: conflictUpdateSet(s.committee) })
    .returning({ id: s.committee.id, fecCommitteeId: s.committee.fecCommitteeId });
  const committeeIds = new Map(committees.map((c) => [c.fecCommitteeId, c.id]));
  const fecCandidateIds = new Map(data.people.map((p) => [p.slug, p.fecCandidateId]));

  const coded = data.committees.flatMap((c) =>
    c.industryId === null
      ? []
      : [
          {
            committeeId: required(committeeIds, c.fecCommitteeId),
            industryId: c.industryId,
            method: 'curated' as const,
            confidence: 1,
            ...provenance(`industry_map:${c.fecCommitteeId}`),
          },
        ],
  );
  await db
    .insert(s.committeeIndustry)
    .values(coded)
    .onConflictDoUpdate({
      target: s.committeeIndustry.committeeId,
      set: conflictUpdateSet(s.committeeIndustry),
    });

  const links = data.committees.flatMap((c) =>
    c.principalFor === null
      ? []
      : [
          {
            fecCandidateId: required(fecCandidateIds, c.principalFor),
            committeeId: required(committeeIds, c.fecCommitteeId),
            cycle: 2024,
            designation: 'P',
            ...provenance(`ccl:${c.fecCommitteeId}:2024`),
          },
        ],
  );
  await db
    .insert(s.committeeLink)
    .values(links)
    .onConflictDoUpdate({
      target: [s.committeeLink.fecCandidateId, s.committeeLink.committeeId, s.committeeLink.cycle],
      set: conflictUpdateSet(s.committeeLink),
    });

  await db
    .insert(s.candidateCycleTotals)
    .values(
      data.totals.map(({ slug, ...t }) => ({
        ...t,
        personId: required(personIds, slug),
        coverageEndDate: '2024-12-31',
        ...provenance(`weball:${t.fecCandidateId}:${t.cycle}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.candidateCycleTotals.fecCandidateId, s.candidateCycleTotals.cycle],
      set: conflictUpdateSet(s.candidateCycleTotals),
    });

  await db
    .insert(s.committeeContribution)
    .values(
      data.contributions.map((c) => ({
        fecSubId: c.fecSubId,
        committeeId: required(committeeIds, c.committeeFecId),
        recipientFecCandidateId: c.fecCandidateId,
        personId: required(personIds, c.slug),
        cycle: c.cycle,
        amountCents: c.amountCents,
        transactionDate: c.transactionDate,
        transactionType: '24K',
        ...provenance(`pas2:${c.fecSubId}`),
      })),
    )
    .onConflictDoUpdate({
      target: s.committeeContribution.fecSubId,
      set: conflictUpdateSet(s.committeeContribution),
    });

  await db
    .insert(s.independentExpenditure)
    .values(
      data.outsideSpending.map((e) => ({
        spenderFecCommitteeId: e.spenderFecId,
        fecTransactionId: e.fecTransactionId,
        spenderCommitteeId: required(committeeIds, e.spenderFecId),
        spenderName: e.spenderName,
        candidateFecId: e.fecCandidateId,
        personId: required(personIds, e.slug),
        supportOppose: e.supportOppose,
        cycle: e.cycle,
        amountCents: e.amountCents,
        expenditureDate: e.expenditureDate,
        purpose: e.purpose,
        ...provenance(`ie:${e.spenderFecId}:${e.fecTransactionId}`),
      })),
    )
    .onConflictDoUpdate({
      target: [
        s.independentExpenditure.spenderFecCommitteeId,
        s.independentExpenditure.fecTransactionId,
      ],
      set: conflictUpdateSet(s.independentExpenditure),
    });
}

interface VoteIds {
  billIds: Map<string, number>;
  rollcallIds: Map<string, number>;
}

const billKey = (b: { billType: string; number: number }) => `${b.billType}${b.number}`;
const rollcallKey = (r: { chamber: string; number: number }) => `${r.chamber}${r.number}`;

async function loadLegislation(
  db: Db,
  data: SeedData,
  personIds: Map<string, number>,
  provenance: Provenance,
): Promise<VoteIds> {
  const bills = await db
    .insert(s.bill)
    .values(
      data.bills.map((b) => ({
        congress: b.congress,
        billType: b.billType,
        number: b.number,
        title: `${b.title} (fictional)`,
        introducedDate: b.introducedDate,
        sponsorPersonId: required(personIds, b.sponsorSlug),
        url: `${EXAMPLE}/bills/${b.congress}-${b.billType}-${b.number}`,
        ...provenance(`bill:${b.congress}-${b.billType}-${b.number}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.bill.congress, s.bill.billType, s.bill.number],
      set: conflictUpdateSet(s.bill),
    })
    .returning({ id: s.bill.id, billType: s.bill.billType, number: s.bill.number });
  const billIds = new Map(bills.map((b) => [billKey(b), b.id]));

  await db
    .insert(s.billPolicyArea)
    .values(
      data.bills.map((b) => ({
        billId: required(billIds, billKey(b)),
        policyAreaId: b.policyAreaId,
        ...provenance(`bill_policy_area:${billKey(b)}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.billPolicyArea.billId, s.billPolicyArea.policyAreaId],
      set: conflictUpdateSet(s.billPolicyArea),
    });

  await db
    .insert(s.billSubject)
    .values(
      data.bills.map((b) => ({
        billId: required(billIds, billKey(b)),
        subject: 'Sample subject (fictional)',
        ...provenance(`bill_subject:${billKey(b)}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.billSubject.billId, s.billSubject.subject],
      set: conflictUpdateSet(s.billSubject),
    });

  const rollcalls = await db
    .insert(s.rollcall)
    .values(
      data.rollcalls.map((r) => {
        const yeaCount = r.positions.filter((p) => p.position === 'yea').length;
        const nayCount = r.positions.filter((p) => p.position === 'nay').length;
        return {
          congress: r.congress,
          chamber: r.chamber,
          number: r.number,
          voteDate: r.voteDate,
          question: r.question,
          description: `Fictional vote on ${r.bill.billType.toUpperCase()} ${r.bill.number}`,
          result: yeaCount > nayCount ? 'Passed' : 'Failed',
          yeaCount,
          nayCount,
          ...provenance(`rollcall:${r.congress}-${r.chamber}-${r.number}`),
        };
      }),
    )
    .onConflictDoUpdate({
      target: [s.rollcall.congress, s.rollcall.chamber, s.rollcall.number],
      set: conflictUpdateSet(s.rollcall),
    })
    .returning({ id: s.rollcall.id, chamber: s.rollcall.chamber, number: s.rollcall.number });
  const rollcallIds = new Map(rollcalls.map((r) => [rollcallKey(r), r.id]));

  await db
    .insert(s.rollcallBill)
    .values(
      data.rollcalls.map((r) => ({
        rollcallId: required(rollcallIds, rollcallKey(r)),
        billId: required(billIds, billKey(r.bill)),
        isFinalPassage: r.isFinalPassage,
        ...provenance(`rollcall_bill:${rollcallKey(r)}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.rollcallBill.rollcallId, s.rollcallBill.billId],
      set: conflictUpdateSet(s.rollcallBill),
    });

  await db
    .insert(s.votePosition)
    .values(
      data.rollcalls.flatMap((r) =>
        r.positions.map((p) => ({
          rollcallId: required(rollcallIds, rollcallKey(r)),
          personId: required(personIds, p.slug),
          position: p.position,
          ...provenance(`vote:${rollcallKey(r)}:${p.slug}`),
        })),
      ),
    )
    .onConflictDoUpdate({
      target: [s.votePosition.rollcallId, s.votePosition.personId],
      set: conflictUpdateSet(s.votePosition),
    });
  return { billIds, rollcallIds };
}

async function loadScores(
  db: Db,
  data: SeedData,
  personIds: Map<string, number>,
  provenance: Provenance,
): Promise<void> {
  await db
    .insert(s.ideologyScore)
    .values(
      data.people.map((p) => ({
        personId: required(personIds, p.slug),
        congress: SEED_CONGRESS,
        method: 'dw-nominate',
        dim1: p.dim1,
        dim2: p.dim2,
        ...provenance(`nominate:${SEED_CONGRESS}:${p.icpsr}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.ideologyScore.personId, s.ideologyScore.congress, s.ideologyScore.method],
      set: conflictUpdateSet(s.ideologyScore),
    });

  await db
    .insert(s.scorecardScore)
    .values(
      data.scores.map((sc) => ({
        publisherId: sc.publisherId,
        personId: required(personIds, sc.slug),
        year: sc.year,
        score: sc.score,
        scaleMin: 0,
        scaleMax: 100,
        scaleLabel: 'Percent of the publisher’s key votes (0–100)',
        methodologyUrl: `${EXAMPLE}/publishers/${sc.publisherId}/methodology/${sc.year}`,
        ...provenance(`scorecard:${sc.publisherId}:${sc.year}:${sc.slug}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.scorecardScore.publisherId, s.scorecardScore.personId, s.scorecardScore.year],
      set: conflictUpdateSet(s.scorecardScore),
    });
}

async function loadCurated(
  db: Db,
  data: SeedData,
  personIds: Map<string, number>,
  { billIds, rollcallIds }: VoteIds,
  provenance: Provenance,
): Promise<void> {
  const promises = await db
    .insert(s.promise)
    .values(
      data.promises.map((p) => ({
        promiseKey: p.promiseKey,
        personId: required(personIds, p.slug),
        policyAreaId: p.policyAreaId,
        statement: p.statement,
        madeOn: p.madeOn,
        sourceUrl: `${EXAMPLE}/promises/${p.promiseKey}`,
        ...provenance(`promise:${p.promiseKey}`),
      })),
    )
    .onConflictDoUpdate({ target: s.promise.promiseKey, set: conflictUpdateSet(s.promise) })
    .returning({ id: s.promise.id, promiseKey: s.promise.promiseKey });
  const promiseIds = new Map(promises.map((p) => [p.promiseKey, p.id]));

  await db
    .insert(s.promiseRating)
    .values(
      data.promises.map((p) => ({
        promiseId: required(promiseIds, p.promiseKey),
        rater: 'Sample Promise Desk (fictional)',
        status: p.status,
        ratedOn: '2026-06-30',
        summary: `Fictional rating: ${p.status.replaceAll('_', ' ')}.`,
        evidence: [
          { url: `${EXAMPLE}/evidence/${p.promiseKey}`, title: 'Fictional evidence note' },
        ],
        ...provenance(`promise_rating:${p.promiseKey}`),
      })),
    )
    .onConflictDoUpdate({
      target: [s.promiseRating.promiseId, s.promiseRating.rater],
      set: conflictUpdateSet(s.promiseRating),
    });

  await db
    .insert(s.platformPosition)
    .values(
      data.platforms.map((p) => ({
        personId: required(personIds, p.slug),
        cycle: p.cycle,
        policyAreaId: p.policyAreaId,
        stance: p.stance,
        sourceUrl: `${EXAMPLE}/platforms/${p.slug}/${p.cycle}`,
        ...provenance(`platform:${p.slug}:${p.cycle}:${p.policyAreaId}`),
      })),
    )
    .onConflictDoUpdate({
      target: [
        s.platformPosition.personId,
        s.platformPosition.cycle,
        s.platformPosition.policyAreaId,
      ],
      set: conflictUpdateSet(s.platformPosition),
    });

  for (const f of data.frameworks) {
    const [row] = await db
      .insert(s.framework)
      .values({
        slug: f.slug,
        version: 1,
        title: f.title,
        author: 'Dev Seed Editors (fictional)',
        statedOrientation: f.statedOrientation,
        description: f.description,
        methodologyUrl: `${EXAMPLE}/frameworks/${f.slug}`,
        ...provenance(`framework:${f.slug}@1`),
      })
      .onConflictDoUpdate({
        target: [s.framework.slug, s.framework.version],
        set: conflictUpdateSet(s.framework),
      })
      .returning({ id: s.framework.id });
    if (!row) throw new Error(`Failed to upsert framework ${f.slug}`);
    await db
      .insert(s.frameworkRule)
      .values(
        f.rules.map(({ target, alignedPosition, rationale }) => {
          const resolved =
            target.kind === 'rollcall'
              ? {
                  key: rollcallKey(target),
                  rollcallId: required(rollcallIds, rollcallKey(target)),
                  billId: null,
                }
              : {
                  key: billKey(target),
                  rollcallId: null,
                  billId: required(billIds, billKey(target)),
                };
          return {
            frameworkId: row.id,
            targetKind: target.kind,
            rollcallId: resolved.rollcallId,
            billId: resolved.billId,
            alignedPosition,
            rationale,
            ...provenance(`framework_rule:${f.slug}@1:${resolved.key}`),
          };
        }),
      )
      .onConflictDoUpdate({
        target: [s.frameworkRule.frameworkId, s.frameworkRule.rollcallId, s.frameworkRule.billId],
        set: conflictUpdateSet(s.frameworkRule),
      });
  }
}
