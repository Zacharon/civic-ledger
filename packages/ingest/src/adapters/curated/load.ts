import {
  bill,
  committee,
  committeeContribution,
  committeeIndustry,
  conflictUpdateSet,
  type Db,
  framework,
  frameworkRule,
  industry,
  platformPosition,
  policyArea,
  promise,
  promiseRating,
  rollcall,
} from '@civic-ledger/db';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { LoadContext, LoadCounts } from '../../adapter';
import { chunks, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { identifierMap } from '../lookups';
import {
  codeCommittees,
  type ExplicitCoding,
  type IndustryRule,
  rulesFromFile,
} from './industry-coding';
import type { CuratedRecord } from './parse';

const COUNT_KEYS = [
  'policy_areas',
  'industries',
  'industry_rules',
  'committees_listed',
  'committees_considered',
  'committees_coded',
  'committees_coded_explicit',
  'committees_coded_by_rule',
  'contribution_cents_total',
  'contribution_cents_coded',
  'industry_coverage_bps',
  'frameworks',
  'framework_rules',
  'promises',
  'promise_ratings',
  'platform_positions',
  'stale_rows_deleted',
] as const;
type CuratedCounts = Counts<(typeof COUNT_KEYS)[number]>;

export async function loadCurated(
  records: AsyncIterable<CuratedRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  const all: CuratedRecord[] = [];
  for await (const r of records) all.push(r);
  const counts = new Counts(COUNT_KEYS);
  const of = <K extends CuratedRecord['kind']>(kind: K) =>
    all.filter((r): r is Extract<CuratedRecord, { kind: K }> => r.kind === kind);

  await ctx.db.transaction(async (tx) => {
    await loadPolicyAreas(tx, of('policy_areas'), counts);
    await loadIndustryMap(tx, ctx, of('industry_map'), counts);
    await loadFrameworks(tx, ctx, of('frameworks'), counts);
    await loadPromises(tx, ctx, of('promises'), counts);
    await loadPlatforms(tx, ctx, of('platforms'), counts);
    counts.set('stale_rows_deleted', await deleteStale(tx, ctx));
  });
  await reportCoverage(ctx.db, counts);
  return counts.toJSON();
}

async function loadPolicyAreas(
  db: Db,
  files: Extract<CuratedRecord, { kind: 'policy_areas' }>[],
  counts: CuratedCounts,
) {
  const areas = files.flatMap((f) => f.data.areas);
  const ids = new Set<string>();
  for (const a of areas) {
    if (ids.has(a.id)) throw new Error(`Policy area id "${a.id}" is defined in more than one file`);
    ids.add(a.id);
  }
  if (areas.length > 0) {
    await db
      .insert(policyArea)
      .values(areas)
      .onConflictDoUpdate({ target: policyArea.id, set: conflictUpdateSet(policyArea) });
  }
  counts.set('policy_areas', areas.length);
}

async function loadIndustryMap(
  db: Db,
  ctx: LoadContext,
  files: Extract<CuratedRecord, { kind: 'industry_map' }>[],
  counts: CuratedCounts,
) {
  const industries = files.flatMap((f) => f.data.industries.map((i) => ({ ...i, file: f.file })));
  const industryIds = new Set<string>();
  for (const i of industries) {
    if (industryIds.has(i.id))
      throw new Error(`Industry "${i.id}" is defined in more than one file`);
    industryIds.add(i.id);
  }
  const explicit: ExplicitCoding[] = files.flatMap((f) =>
    f.data.committees.map((c) => ({
      key: `${f.file}#${c.fec_committee_id}`,
      fecCommitteeId: c.fec_committee_id,
      industry: c.industry,
      method: c.method,
      confidence: c.confidence,
    })),
  );
  const rules: IndustryRule[] = files.flatMap((f) => rulesFromFile(f.file, f.data));
  const listedIds = new Set<string>();
  for (const e of explicit) {
    if (listedIds.has(e.fecCommitteeId))
      throw new Error(`Committee ${e.fecCommitteeId} is coded in more than one file`);
    listedIds.add(e.fecCommitteeId);
  }
  for (const ref of [...explicit, ...rules]) {
    if (!industryIds.has(ref.industry))
      throw new Error(`${ref.key}: unknown industry "${ref.industry}"`);
  }

  if (industries.length > 0) {
    await db
      .insert(industry)
      .values(
        industries.map((i) => ({
          id: i.id,
          name: i.name,
          sector: i.sector,
          ...provenance(ctx, `${i.file}#${i.id}`),
        })),
      )
      .onConflictDoUpdate({ target: industry.id, set: conflictUpdateSet(industry) });
  }
  counts.set('industries', industries.length);
  counts.set('industry_rules', rules.length);
  counts.set('committees_listed', explicit.length);

  const committees = await db
    .select({
      id: committee.id,
      fecCommitteeId: committee.fecCommitteeId,
      name: committee.name,
      connectedOrganization: committee.connectedOrganization,
      organizationType: committee.organizationType,
      designation: committee.designation,
      committeeType: committee.committeeType,
    })
    .from(committee);
  const codings = codeCommittees(committees, explicit, rules);
  for (const batch of chunks(codings)) {
    await db
      .insert(committeeIndustry)
      .values(
        batch.map((c) => ({
          committeeId: c.committeeId,
          industryId: c.industryId,
          method: c.method,
          confidence: c.confidence,
          ...provenance(ctx, c.sourceKey),
        })),
      )
      .onConflictDoUpdate({
        target: committeeIndustry.committeeId,
        set: conflictUpdateSet(committeeIndustry),
      });
  }
  counts.set('committees_considered', committees.length);
  counts.set('committees_coded', codings.length);
  counts.set('committees_coded_explicit', codings.filter((c) => c.method === 'curated').length);
  counts.set('committees_coded_by_rule', codings.filter((c) => c.method !== 'curated').length);
}

async function loadFrameworks(
  db: Db,
  ctx: LoadContext,
  files: Extract<CuratedRecord, { kind: 'frameworks' }>[],
  counts: CuratedCounts,
) {
  for (const { file, data } of files) {
    const [fw] = await db
      .insert(framework)
      .values({
        slug: data.slug,
        version: data.version,
        title: data.title,
        author: data.author,
        statedOrientation: data.stated_orientation,
        description: data.description,
        methodologyUrl: data.methodology_url ?? null,
        ...provenance(ctx, file),
      })
      .onConflictDoUpdate({
        target: [framework.slug, framework.version],
        set: conflictUpdateSet(framework),
      })
      .returning({ id: framework.id });
    if (!fw) throw new Error(`${file}: framework upsert returned nothing`);
    const ruleIds: number[] = [];
    for (const [index, rule] of data.rules.entries()) {
      const target = await resolveTarget(db, rule.target);
      if (!target)
        throw new Error(
          `${file}: rules.${index}.target ${JSON.stringify(rule.target)} is not loaded`,
        );
      const [row] = await db
        .insert(frameworkRule)
        .values({
          frameworkId: fw.id,
          targetKind: rule.target.kind,
          rollcallId: target.rollcallId,
          billId: target.billId,
          alignedPosition: rule.aligned_position,
          weight: rule.weight,
          rationale: rule.rationale,
          ...provenance(ctx, `${file}#rules.${index}`),
        })
        .onConflictDoUpdate({
          target: [frameworkRule.frameworkId, frameworkRule.rollcallId, frameworkRule.billId],
          set: conflictUpdateSet(frameworkRule),
        })
        .returning({ id: frameworkRule.id });
      if (row) ruleIds.push(row.id);
    }
    counts.add('frameworks');
    counts.add('framework_rules', ruleIds.length);
  }
}

async function resolveTarget(
  db: Db,
  target: Extract<CuratedRecord, { kind: 'frameworks' }>['data']['rules'][number]['target'],
): Promise<{ rollcallId: number | null; billId: number | null } | null> {
  if (target.kind === 'rollcall') {
    const [row] = await db
      .select({ id: rollcall.id })
      .from(rollcall)
      .where(
        and(
          eq(rollcall.congress, target.congress),
          eq(rollcall.chamber, target.chamber),
          eq(rollcall.number, target.number),
        ),
      );
    return row ? { rollcallId: row.id, billId: null } : null;
  }
  const [row] = await db
    .select({ id: bill.id })
    .from(bill)
    .where(
      and(
        eq(bill.congress, target.congress),
        eq(bill.billType, target.bill_type),
        eq(bill.number, target.number),
      ),
    );
  return row ? { rollcallId: null, billId: row.id } : null;
}

async function personByBioguide(db: Db, bioguide: string, file: string): Promise<number> {
  const id = (await identifierMap(db, 'bioguide')).get(bioguide);
  if (id === undefined)
    throw new Error(
      `${file}: no person with bioguide ${bioguide} (load congress-legislators first)`,
    );
  return id;
}

async function loadPromises(
  db: Db,
  ctx: LoadContext,
  files: Extract<CuratedRecord, { kind: 'promises' }>[],
  counts: CuratedCounts,
) {
  for (const { file, data } of files) {
    const personId = await personByBioguide(db, data.person.bioguide, file);
    for (const p of data.promises) {
      const [row] = await db
        .insert(promise)
        .values({
          promiseKey: `${data.person.bioguide}:${p.id}`,
          personId,
          policyAreaId: p.policy_area ?? null,
          statement: p.statement,
          madeOn: p.made_on,
          sourceUrl: p.source_url,
          ...provenance(ctx, `${file}#${p.id}`),
        })
        .onConflictDoUpdate({ target: promise.promiseKey, set: conflictUpdateSet(promise) })
        .returning({ id: promise.id });
      if (!row) throw new Error(`${file}#${p.id}: promise upsert returned nothing`);
      counts.add('promises');
      for (const r of p.ratings) {
        await db
          .insert(promiseRating)
          .values({
            promiseId: row.id,
            rater: r.rater,
            status: r.status,
            ratedOn: r.rated_on,
            summary: r.summary ?? null,
            evidence: r.evidence,
            ...provenance(ctx, `${file}#${p.id}:${r.rater}`),
          })
          .onConflictDoUpdate({
            target: [promiseRating.promiseId, promiseRating.rater],
            set: conflictUpdateSet(promiseRating),
          });
        counts.add('promise_ratings');
      }
    }
  }
}

async function loadPlatforms(
  db: Db,
  ctx: LoadContext,
  files: Extract<CuratedRecord, { kind: 'platforms' }>[],
  counts: CuratedCounts,
) {
  for (const { file, data } of files) {
    const personId = await personByBioguide(db, data.person.bioguide, file);
    for (const p of data.positions) {
      await db
        .insert(platformPosition)
        .values({
          personId,
          cycle: data.cycle,
          policyAreaId: p.policy_area,
          stance: p.stance,
          sourceUrl: p.source_url,
          ...provenance(ctx, `${file}#${p.policy_area}`),
        })
        .onConflictDoUpdate({
          target: [
            platformPosition.personId,
            platformPosition.cycle,
            platformPosition.policyAreaId,
          ],
          set: conflictUpdateSet(platformPosition),
        });
      counts.add('platform_positions');
    }
  }
}

/**
 * The curated folder is the complete reviewed state: anything this source loaded before
 * but not in this run was removed in git and is deleted here (children first).
 */
async function deleteStale(db: Db, ctx: LoadContext): Promise<number> {
  const old = (t: { sourceId: AnyPgColumn; ingestRunId: AnyPgColumn }) =>
    and(eq(t.sourceId, ctx.sourceId), ne(t.ingestRunId, ctx.ingestRunId));
  let n = 0;
  n += (
    await db.delete(promiseRating).where(old(promiseRating)).returning({ id: promiseRating.id })
  ).length;
  const stalePromises = db.select({ id: promise.id }).from(promise).where(old(promise));
  n += (
    await db
      .delete(promiseRating)
      .where(inArray(promiseRating.promiseId, stalePromises))
      .returning({ id: promiseRating.id })
  ).length;
  n += (await db.delete(promise).where(old(promise)).returning({ id: promise.id })).length;
  n += (
    await db
      .delete(platformPosition)
      .where(old(platformPosition))
      .returning({ id: platformPosition.id })
  ).length;
  n += (
    await db.delete(frameworkRule).where(old(frameworkRule)).returning({ id: frameworkRule.id })
  ).length;
  const staleFrameworks = db.select({ id: framework.id }).from(framework).where(old(framework));
  n += (
    await db
      .delete(frameworkRule)
      .where(inArray(frameworkRule.frameworkId, staleFrameworks))
      .returning({ id: frameworkRule.id })
  ).length;
  n += (await db.delete(framework).where(old(framework)).returning({ id: framework.id })).length;
  n += (
    await db
      .delete(committeeIndustry)
      .where(old(committeeIndustry))
      .returning({ id: committeeIndustry.id })
  ).length;
  const liveIndustries = db.select({ id: committeeIndustry.industryId }).from(committeeIndustry);
  n += (
    await db
      .delete(industry)
      .where(and(old(industry), notInArray(industry.id, liveIndustries)))
      .returning({ id: industry.id })
  ).length;
  return n;
}

/**
 * Coverage = share of committee → candidate contribution dollars (latest cycle loaded)
 * from committees that carry an industry code. Reported in basis points (integer receipt).
 */
async function reportCoverage(db: Db, counts: CuratedCounts) {
  const [latest] = await db
    .select({ cycle: sql<number | null>`max(${committeeContribution.cycle})` })
    .from(committeeContribution);
  if (!latest?.cycle) return;
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${committeeContribution.amountCents}), 0)::text`,
      coded: sql<string>`coalesce(sum(${committeeContribution.amountCents}) filter (where ${committeeIndustry.id} is not null), 0)::text`,
    })
    .from(committeeContribution)
    .leftJoin(
      committeeIndustry,
      eq(committeeIndustry.committeeId, committeeContribution.committeeId),
    )
    .where(eq(committeeContribution.cycle, latest.cycle));
  const total = Number(row?.total ?? 0);
  const coded = Number(row?.coded ?? 0);
  counts.set('contribution_cents_total', total);
  counts.set('contribution_cents_coded', coded);
  counts.set('industry_coverage_bps', total > 0 ? Math.round((coded / total) * 10_000) : 0);
}
