import { conflictUpdateSet, type Db, person, personIdentifier, term } from '@civic-ledger/db';
import { and, eq, ne } from 'drizzle-orm';
import type { LoadContext, LoadCounts } from '../../adapter';
import { slugify } from '../../parse/values';
import { chunked, lastPerKey, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { OfficeResolver } from '../lookups';
import type { LegislatorRecord } from './parse';

/**
 * Slugs are minted once from name + bioguide and never change afterwards (stable URLs,
 * unique even for the many historical namesakes); later name changes update the name only.
 */
export const personSlug = (r: Pick<LegislatorRecord, 'firstName' | 'lastName' | 'bioguide'>) =>
  slugify(`${r.firstName} ${r.lastName} ${r.bioguide}`);

const BATCH = 500;

export async function loadLegislators(
  records: AsyncIterable<LegislatorRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  const { db } = ctx;
  const existingSlugs = await slugsByBioguide(db);
  const offices = new OfficeResolver();
  const counts = new Counts([
    'people',
    'people_new',
    'identifiers',
    'terms',
    'offices',
    'terms_party_split',
    'terms_without_party',
    'duplicate_bioguide_records',
    'stale_terms_deleted',
    'stale_identifiers_deleted',
  ] as const);
  const seen = new Set<string>();

  for await (const raw of chunked(records, BATCH)) {
    const batch = raw.filter((r) => {
      if (seen.has(r.bioguide)) {
        counts.add('duplicate_bioguide_records');
        return false;
      }
      seen.add(r.bioguide);
      return true;
    });
    await db.transaction(async (tx) => {
      const personRows = batch.map((r) => ({
        slug: existingSlugs.get(r.bioguide) ?? personSlug(r),
        fullName: r.fullName,
        firstName: r.firstName,
        lastName: r.lastName,
        birthDate: r.birthDate,
        ...provenance(ctx, `bioguide:${r.bioguide}`),
      }));
      const inserted = await tx
        .insert(person)
        .values(personRows)
        .onConflictDoUpdate({
          target: person.slug,
          set: conflictUpdateSet(person),
        })
        .returning({ id: person.id, slug: person.slug });
      const idBySlug = new Map(inserted.map((p) => [p.slug, p.id]));
      const personId = (r: LegislatorRecord): number => {
        const id = idBySlug.get(existingSlugs.get(r.bioguide) ?? personSlug(r));
        if (id === undefined) throw new Error(`No person id for ${r.bioguide}`);
        return id;
      };
      for (const r of batch) {
        if (!existingSlugs.has(r.bioguide)) {
          counts.add('people_new');
          existingSlugs.set(r.bioguide, personSlug(r));
        }
      }

      const identifierRows = lastPerKey(
        batch.flatMap((r) =>
          r.identifiers.map((i) => ({
            personId: personId(r),
            scheme: i.scheme,
            value: i.value,
            ...provenance(ctx, `bioguide:${r.bioguide}:${i.scheme}`),
          })),
        ),
        (row) => `${row.scheme}|${row.value}`,
      );
      if (identifierRows.length > 0) {
        await tx
          .insert(personIdentifier)
          .values(identifierRows)
          .onConflictDoUpdate({
            target: [personIdentifier.scheme, personIdentifier.value],
            set: conflictUpdateSet(personIdentifier),
          });
      }

      const allTerms = batch.flatMap((r) => r.terms.map((t) => ({ r, t })));
      await offices.resolve(
        tx,
        allTerms.map(({ t }) => t),
      );
      const termRows = lastPerKey(
        allTerms.map(({ r, t }) => ({
          personId: personId(r),
          officeId: offices.idFor(t),
          party: t.party,
          startDate: t.start,
          endDate: t.end,
          ...provenance(ctx, `bioguide:${r.bioguide}:term:${t.start}`),
        })),
        (row) => `${row.personId}|${row.officeId}|${row.startDate}`,
      );
      if (termRows.length > 0) {
        await tx
          .insert(term)
          .values(termRows)
          .onConflictDoUpdate({
            target: [term.personId, term.officeId, term.startDate],
            set: conflictUpdateSet(term),
          });
      }

      counts.add('people', batch.length);
      counts.add('identifiers', identifierRows.length);
      counts.add('terms', termRows.length);
      for (const r of batch) {
        counts.add('terms_party_split', r.partySplits);
        counts.add('terms_without_party', r.termsWithoutParty);
      }
    });
  }

  // The two files are the complete c-l dataset, so rows this source asserted earlier but
  // not now (a corrected term start, a removed FEC id) are stale. People are never deleted.
  await db.transaction(async (tx) => {
    const staleTerms = await tx
      .delete(term)
      .where(and(eq(term.sourceId, ctx.sourceId), ne(term.ingestRunId, ctx.ingestRunId)))
      .returning({ id: term.id });
    const staleIds = await tx
      .delete(personIdentifier)
      .where(
        and(
          eq(personIdentifier.sourceId, ctx.sourceId),
          ne(personIdentifier.ingestRunId, ctx.ingestRunId),
        ),
      )
      .returning({ id: personIdentifier.id });
    counts.set('stale_terms_deleted', staleTerms.length);
    counts.set('stale_identifiers_deleted', staleIds.length);
  });
  counts.set('offices', (await offices.resolve(db, [])).size);
  return counts.toJSON();
}

async function slugsByBioguide(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ bioguide: personIdentifier.value, slug: person.slug })
    .from(personIdentifier)
    .innerJoin(person, eq(person.id, personIdentifier.personId))
    .where(eq(personIdentifier.scheme, 'bioguide'));
  return new Map(rows.map((r) => [r.bioguide, r.slug]));
}
