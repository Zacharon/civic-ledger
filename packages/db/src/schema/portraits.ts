import { customType, index, integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { person } from './identity';
import { provenanceColumns, provenanceIndexes } from './provenance';

/**
 * Self-hosted official portrait files (DECISIONS A72). The variant names are the folder
 * names of the upstream repository (unitedstates/images), width x height in pixels.
 */
export const PORTRAIT_VARIANTS = ['225x275', '450x550'] as const;
export const portraitVariant = pgEnum('portrait_variant', PORTRAIT_VARIANTS);
export type PortraitVariant = (typeof PORTRAIT_VARIANTS)[number];

/** Postgres `bytea`; node-postgres hands back a Buffer, PGlite a Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

/** One validated JPEG per person and variant. Bytes are stored, never fetched at read time. */
export const personPortrait = pgTable(
  'person_portrait',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    personId: integer('person_id')
      .notNull()
      .references(() => person.id),
    variant: portraitVariant('variant').notNull(),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    byteLength: integer('byte_length').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Lower-case hex sha256 of `data`: the ETag and the cache-busting key. */
    sha256: text('sha256').notNull(),
    /** Where the bytes were downloaded from. */
    originUrl: text('origin_url').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('person_portrait_natural_key').on(t.personId, t.variant),
    index('person_portrait_person_idx').on(t.personId),
    ...provenanceIndexes('person_portrait', t),
  ],
);
