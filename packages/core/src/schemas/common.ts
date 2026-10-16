import { CHAMBERS, VOTE_POSITIONS } from '@civic-ledger/db';
import { z } from 'zod';

export const SlugSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lowercase kebab-case slug');

export const StateCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Expected a two-letter uppercase state code');

export const ChamberSchema = z.enum(CHAMBERS);
export const VotePositionSchema = z.enum(VOTE_POSITIONS);
export const PartySchema = z.string().min(1).max(80);
export const CongressSchema = z.int().min(1).max(200);
export const CycleSchema = z.int().min(1976).max(2100);
export const IsoDateSchema = z.iso.date();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const CentsSchema = z.int().describe('US dollars in integer cents');
export const ShareSchema = z.number().min(0).max(1).describe('Fraction in [0, 1]');

export const ProvenanceSchema = z
  .object({
    sourceId: z.string(),
    sourceKey: z.string(),
    ingestRunId: z.int(),
    retrievedAt: IsoDateTimeSchema,
  })
  .describe('Where this fact came from; resolve `sourceId` with sources.status.');
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const PaginationInput = {
  limit: z.int().min(1).max(100).default(50),
  offset: z.int().min(0).max(100_000).default(0),
};

export const PageSchema = {
  total: z.int().min(0),
  limit: z.int(),
  offset: z.int(),
};

export const PersonRefSchema = z.object({
  slug: SlugSchema,
  fullName: z.string(),
});

export const PolicyAreaRefSchema = z.object({ id: z.string(), name: z.string() });

export const RollcallRefSchema = z.object({
  congress: CongressSchema,
  chamber: ChamberSchema,
  number: z.int().positive(),
  voteDate: IsoDateSchema,
  question: z.string(),
  result: z.string(),
});

export const BillRefSchema = z.object({
  congress: CongressSchema,
  billType: z.string(),
  number: z.int().positive(),
  title: z.string(),
  url: z.url(),
});

export const EmptyInputSchema = z.strictObject({});
