import { conflictUpdateSet, personPortrait } from '@civic-ledger/db';
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import type { LoadContext, LoadCounts } from '../../adapter';
import { chunked, provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import { identifierMap } from '../lookups';
import type { PortraitParsed } from './parse';
import { bioguideIdsInScope } from './plan';

/** Two images of ~20-200 KB per person; this many people per INSERT keeps statements ~5 MB. */
const PEOPLE_PER_BATCH = 10;

export async function loadMemberPhotos(
  records: AsyncIterable<PortraitParsed>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  const { db } = ctx;
  const personIds = await identifierMap(db, 'bioguide');
  const counts = new Counts([
    'portraits',
    'people_with_portrait',
    'portrait_bytes',
    'origin_bytes',
    'metadata_bytes_removed',
    'files_with_exif',
    'files_with_gps',
    'files_with_thumbnail',
    'people_without_450',
    'people_in_scope',
    'people_without_portrait',
    'files_rejected',
    'rejected_bad_name',
    'rejected_missing_1x',
    'rejected_too_large',
    'rejected_not_jpeg',
    'rejected_wrong_size',
    'rejected_unreadable',
    'bioguide_not_in_legislators',
    'rejected_kept_previous',
    'stale_portraits_deleted',
  ] as const);
  const loaded = new Set<number>();
  const keepPrevious = new Set<number>();

  for await (const batch of chunked(records, PEOPLE_PER_BATCH)) {
    ctx.checkpoint?.();
    const rows: (typeof personPortrait.$inferInsert)[] = [];
    for (const record of batch) {
      if (record.kind === 'rejected') {
        counts.add('files_rejected');
        counts.add(`rejected_${record.reason}`);
        ctx.logger.warn(
          { bioguide: record.bioguide, reason: record.reason, detail: record.detail },
          'portrait rejected',
        );
        const rejectedId = personIds.get(record.bioguide);
        if (rejectedId !== undefined) keepPrevious.add(rejectedId);
        continue;
      }
      const personId = personIds.get(record.bioguide);
      if (personId === undefined) {
        counts.add('bioguide_not_in_legislators');
        continue;
      }
      loaded.add(personId);
      if (record.files.length < 2) counts.add('people_without_450');
      for (const file of record.files) {
        counts.add('portraits');
        counts.add('portrait_bytes', file.bytes.byteLength);
        counts.add('origin_bytes', file.originBytes);
        counts.add('metadata_bytes_removed', file.removedBytes);
        if (file.hadExif) counts.add('files_with_exif');
        if (file.hadGps) counts.add('files_with_gps');
        if (file.hadThumbnail) counts.add('files_with_thumbnail');
        rows.push({
          personId,
          variant: file.variant,
          contentType: 'image/jpeg',
          data: file.bytes,
          byteLength: file.bytes.byteLength,
          width: file.width,
          height: file.height,
          sha256: file.sha256,
          originSha256: file.originSha256,
          originByteLength: file.originBytes,
          originUrl: file.originUrl,
          ...provenance(ctx, `portrait:${record.bioguide}:${file.variant}`),
        });
      }
    }
    if (rows.length === 0) continue;
    await db.transaction(async (tx) => {
      await tx
        .insert(personPortrait)
        .values(rows)
        .onConflictDoUpdate({
          target: [personPortrait.personId, personPortrait.variant],
          set: conflictUpdateSet(personPortrait),
        });
    });
  }
  counts.set('people_with_portrait', loaded.size);

  // The snapshot is the complete set this source asserts. A portrait that is no longer
  // listed is stale and goes; a person whose new files were rejected keeps the previous
  // good pair rather than losing it to one bad download.
  const stillRejected =
    keepPrevious.size > 0 ? [...keepPrevious].filter((id) => !loaded.has(id)) : [];
  const sweep = and(
    eq(personPortrait.sourceId, ctx.sourceId),
    ne(personPortrait.ingestRunId, ctx.ingestRunId),
    stillRejected.length > 0 ? notInArray(personPortrait.personId, stillRejected) : undefined,
  );
  const stale = await db.delete(personPortrait).where(sweep).returning({ id: personPortrait.id });
  counts.set('stale_portraits_deleted', stale.length);
  if (stillRejected.length > 0) {
    const kept = await db
      .select({ personId: personPortrait.personId })
      .from(personPortrait)
      .where(inArray(personPortrait.personId, stillRejected));
    counts.set('rejected_kept_previous', new Set(kept.map((r) => r.personId)).size);
  }

  const scoped = new Set(await bioguideIdsInScope(db));
  counts.set('people_in_scope', scoped.size);
  const withPortrait = new Set<string>();
  for (const [bioguide, id] of personIds) if (loaded.has(id)) withPortrait.add(bioguide);
  counts.set(
    'people_without_portrait',
    [...scoped].filter((bioguide) => !withPortrait.has(bioguide)).length,
  );
  return counts.toJSON();
}
