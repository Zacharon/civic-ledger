import { ALIGNED_POSITIONS, INDUSTRY_CODING_METHODS, PROMISE_STATUSES } from '@civic-ledger/db';
import { z } from 'zod';
import { BillTypeSchema } from '../frameworks/spec';
import {
  ChamberSchema,
  CongressSchema,
  CycleSchema,
  IsoDateSchema,
  SlugSchema,
} from '../schemas/common';

/**
 * Schemas for git-reviewed YAML under data/curated/<kind>/. Keys are snake_case for
 * human editing. Bump `schema_version` (and add a migration note) on breaking changes.
 */
export const CURATED_SCHEMA_VERSION = 1;
export const CURATED_KINDS = ['promises', 'platforms', 'frameworks', 'industry_map'] as const;
export type CuratedKind = (typeof CURATED_KINDS)[number];

const SchemaVersion = z.literal(CURATED_SCHEMA_VERSION);
const HttpsUrl = z.url({ protocol: /^https$/ });
const PersonRef = z.strictObject({
  bioguide: z.string().regex(/^[A-Z]\d{6}$/, 'Expected a bioguide id like A000360'),
});

const uniqueBy =
  <T>(key: (item: T) => string, label: string) =>
  (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const value = key(item);
      if (seen.has(value))
        ctx.addIssue({ code: 'custom', message: `Duplicate ${label} "${value}"`, path: [index] });
      seen.add(value);
    });
  };

const EvidenceSchema = z.strictObject({
  url: HttpsUrl,
  title: z.string().min(1).max(300),
  note: z.string().max(2000).optional(),
});

export const CuratedPromisesFileSchema = z.strictObject({
  schema_version: SchemaVersion,
  person: PersonRef,
  promises: z
    .array(
      z.strictObject({
        id: SlugSchema,
        statement: z.string().min(1).max(2000),
        made_on: IsoDateSchema,
        policy_area: SlugSchema.optional(),
        source_url: HttpsUrl,
        ratings: z
          .array(
            z.strictObject({
              rater: z.string().min(1).max(200),
              status: z.enum(PROMISE_STATUSES),
              rated_on: IsoDateSchema,
              summary: z.string().max(2000).optional(),
              evidence: z.array(EvidenceSchema).min(1),
            }),
          )
          .default([]),
      }),
    )
    .min(1)
    .superRefine(uniqueBy((p) => p.id, 'promise id')),
});

export const CuratedPlatformsFileSchema = z.strictObject({
  schema_version: SchemaVersion,
  person: PersonRef,
  cycle: CycleSchema,
  positions: z
    .array(
      z.strictObject({
        policy_area: SlugSchema,
        stance: z.string().min(1).max(2000),
        source_url: HttpsUrl,
      }),
    )
    .min(1)
    .superRefine(uniqueBy((p) => p.policy_area, 'policy_area')),
});

const CuratedRuleTarget = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rollcall'),
    congress: CongressSchema,
    chamber: ChamberSchema,
    number: z.int().positive(),
  }),
  z.strictObject({
    kind: z.literal('bill'),
    congress: CongressSchema,
    bill_type: BillTypeSchema,
    number: z.int().positive(),
  }),
]);

export const CuratedFrameworkFileSchema = z.strictObject({
  schema_version: SchemaVersion,
  slug: SlugSchema,
  version: z.int().positive(),
  title: z.string().min(1).max(200),
  author: z.string().min(1).max(200),
  stated_orientation: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  methodology_url: HttpsUrl.optional(),
  rules: z
    .array(
      z.strictObject({
        target: CuratedRuleTarget,
        aligned_position: z.enum(ALIGNED_POSITIONS),
        weight: z.number().positive().max(100).default(1),
        rationale: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(200)
    .superRefine(uniqueBy((r) => JSON.stringify(r.target), 'rule target')),
});

export const CuratedIndustryMapFileSchema = z.strictObject({
  schema_version: SchemaVersion,
  industries: z
    .array(
      z.strictObject({
        id: SlugSchema,
        name: z.string().min(1).max(200),
        sector: z.string().min(1).max(200),
      }),
    )
    .default([])
    .superRefine(uniqueBy((i) => i.id, 'industry id')),
  committees: z
    .array(
      z.strictObject({
        fec_committee_id: z
          .string()
          .regex(/^C\d{8}$/, 'Expected an FEC committee id like C00123456'),
        industry: SlugSchema,
        method: z.enum(INDUSTRY_CODING_METHODS),
        confidence: z.number().min(0).max(1),
        note: z.string().max(2000).optional(),
      }),
    )
    .default([])
    .superRefine(uniqueBy((c) => c.fec_committee_id, 'fec_committee_id')),
});

export const CURATED_FILE_SCHEMAS = {
  promises: CuratedPromisesFileSchema,
  platforms: CuratedPlatformsFileSchema,
  frameworks: CuratedFrameworkFileSchema,
  industry_map: CuratedIndustryMapFileSchema,
} as const satisfies Record<CuratedKind, z.ZodType>;

export type CuratedPromisesFile = z.output<typeof CuratedPromisesFileSchema>;
export type CuratedPlatformsFile = z.output<typeof CuratedPlatformsFileSchema>;
export type CuratedFrameworkFile = z.output<typeof CuratedFrameworkFileSchema>;
export type CuratedIndustryMapFile = z.output<typeof CuratedIndustryMapFileSchema>;
