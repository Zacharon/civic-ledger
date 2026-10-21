import { type Db, type PortraitVariant, person, personPortrait } from '@civic-ledger/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { IsoDateTimeSchema, ProvenanceSchema, SlugSchema } from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

/** Pixel widths served, 1x and 2x. Each maps to an upstream variant folder. */
export const PORTRAIT_SIZES = [225, 450] as const;
export type PortraitSize = (typeof PORTRAIT_SIZES)[number];

export const VARIANT_FOR_SIZE: Record<PortraitSize, PortraitVariant> = {
  225: '225x275',
  450: '450x550',
};

/**
 * Shown under every portrait; the same words on every record (DESIGN.md "Portraits"). It is
 * true of every file: most come from the GPO Member Guide, but the collection also accepts other
 * official public-domain photos (e.g. O000172 is credited to the House Office of Photography), so
 * the line names the collection, not one origin.
 */
export const PORTRAIT_CREDIT = 'Official portrait · public domain · via unitedstates/images';

/** Cache-busting key: the first characters of the file's sha256. */
export const PORTRAIT_CACHE_KEY_LENGTH = 12;

/**
 * Site-relative address of a portrait file. `v` is the cache-busting key: it changes
 * whenever the bytes do, so the file can be cached as immutable.
 */
export function portraitPath(slug: string, size: PortraitSize, sha256: string): string {
  return `/people/${slug}/portrait?size=${size}&v=${sha256.slice(0, PORTRAIT_CACHE_KEY_LENGTH)}`;
}

const PortraitVariantFactSchema = z.object({
  size: z.literal([...PORTRAIT_SIZES]).describe('Pixel width of this file'),
  url: z.string().describe('Site-relative address of the image; resolve against the site origin'),
  width: z.int(),
  height: z.int(),
  sha256: z.string().describe('sha256 of the image bytes; also the ETag'),
});

/**
 * The official portrait of a member, or null when none is on file. Facts only: the image
 * itself is a separate request (`people.portrait`, `/people/<slug>/portrait`).
 */
export const PortraitSchema = z
  .object({
    url: z.string().describe('The 1x image (225 px wide), site-relative'),
    width: z.int().describe('Width of the 1x image in pixels'),
    height: z.int().describe('Height of the 1x image in pixels'),
    credit: z.string(),
    sourceUrl: z.url().describe('Where this exact file was downloaded from'),
    asOf: IsoDateTimeSchema.describe('When the file was retrieved'),
    variants: z.array(PortraitVariantFactSchema).describe('1x then 2x files, for srcset'),
    provenance: ProvenanceSchema,
  })
  .nullable();
export type Portrait = z.infer<typeof PortraitSchema>;

/** Portrait facts for one person (no image bytes are read). Null without a 1x file. */
export async function portraitFacts(db: Db, personId: number, slug: string): Promise<Portrait> {
  const rows = await db
    .select({
      variant: personPortrait.variant,
      width: personPortrait.width,
      height: personPortrait.height,
      sha256: personPortrait.sha256,
      originUrl: personPortrait.originUrl,
      ...provenanceFields(personPortrait),
    })
    .from(personPortrait)
    .where(eq(personPortrait.personId, personId));
  const sizes = PORTRAIT_SIZES.flatMap((size) => {
    const row = rows.find((r) => r.variant === VARIANT_FOR_SIZE[size]);
    return row ? [{ size, row }] : [];
  });
  const base = sizes.find((s) => s.size === 225);
  if (!base) return null;
  const { sourceId, sourceKey, ingestRunId, retrievedAt } = base.row;
  return {
    url: portraitPath(slug, 225, base.row.sha256),
    width: base.row.width,
    height: base.row.height,
    credit: PORTRAIT_CREDIT,
    sourceUrl: base.row.originUrl,
    asOf: retrievedAt.toISOString(),
    variants: sizes.map(({ size, row }) => ({
      size,
      url: portraitPath(slug, size, row.sha256),
      width: row.width,
      height: row.height,
      sha256: row.sha256,
    })),
    provenance: withProvenance({ sourceId, sourceKey, ingestRunId, retrievedAt }).provenance,
  };
}

// people.portrait@1 ----------------------------------------------------------

export const PeoplePortraitInput = z.strictObject({
  slug: SlugSchema,
  size: z
    .literal([...PORTRAIT_SIZES])
    .default(225)
    .describe('Pixel width: 225 (1x) or 450 (2x)'),
  v: z
    .string()
    .regex(/^[0-9a-f]{8,64}$/)
    .optional()
    .describe(
      'Cache-busting key from people.get (the sha256 prefix). It never selects a file; only ' +
        'a key matching the served bytes lets the response be cached as immutable.',
    ),
});

/** Image bytes are binary: JSON adapters must not serialize this output (see `transport`). */
export const PeoplePortraitOutput = z.object({
  slug: SlugSchema,
  size: z.literal([...PORTRAIT_SIZES]),
  contentType: z.literal('image/jpeg'),
  width: z.int(),
  height: z.int(),
  sha256: z.string(),
  byteLength: z.int(),
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Expected bytes'),
});

export const peoplePortrait = defineCapability({
  name: 'people.portrait',
  version: 1,
  kind: 'read',
  audience: 'public',
  transport: 'binary',
  summary:
    'The official portrait image (JPEG, metadata removed) of a member, 225 or 450 px wide. Public domain, via the unitedstates/images collection; get its credit and facts from people.get.',
  input: PeoplePortraitInput,
  output: PeoplePortraitOutput,
  async handler({ db }, { slug, size }) {
    const [row] = await db
      .select({
        contentType: personPortrait.contentType,
        width: personPortrait.width,
        height: personPortrait.height,
        sha256: personPortrait.sha256,
        byteLength: personPortrait.byteLength,
        bytes: personPortrait.data,
      })
      .from(personPortrait)
      .innerJoin(person, eq(person.id, personPortrait.personId))
      .where(and(eq(person.slug, slug), eq(personPortrait.variant, VARIANT_FOR_SIZE[size])))
      .limit(1);
    if (!row) throw notFound(`No official portrait on file for "${slug}" at ${size} px`);
    return {
      slug,
      size,
      contentType: row.contentType as 'image/jpeg',
      width: row.width,
      height: row.height,
      sha256: row.sha256,
      byteLength: row.byteLength,
      // node-postgres returns a pooled Buffer, PGlite a Uint8Array: hand every adapter the same type.
      bytes: new Uint8Array(row.bytes.buffer, row.bytes.byteOffset, row.bytes.byteLength),
    };
  },
});
