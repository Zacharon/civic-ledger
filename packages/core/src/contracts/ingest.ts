import { INGEST_STATUSES } from '@civic-ledger/db';
import { z } from 'zod';
import { CongressSchema, CycleSchema, IsoDateTimeSchema } from '../schemas/common';

/**
 * `ingest.run@1` contract (CAPABILITIES.md "Write semantics"). The handler lives in
 * packages/ingest and runs only from the operator CLI; it is never in the public registry.
 */
export const SOURCE_IDS = [
  'congress-legislators',
  'voteview',
  'fec-bulk',
  'govinfo-billstatus',
  'congress-gov',
  'curated',
  'openstates',
] as const;
export const SourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceIdSchema>;

export const IngestScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cycle'), cycle: CycleSchema }),
  z.strictObject({ kind: z.literal('congress'), congress: CongressSchema }),
  z.strictObject({ kind: z.literal('all') }),
]);
export type IngestScope = z.infer<typeof IngestScopeSchema>;

/** Stable text form stored in `ingest_run.scope`, e.g. `cycle:2026`. */
export function formatIngestScope(scope: IngestScope): string {
  switch (scope.kind) {
    case 'cycle':
      return `cycle:${scope.cycle}`;
    case 'congress':
      return `congress:${scope.congress}`;
    case 'all':
      return 'all';
  }
}

export const IngestRunInputSchema = z.strictObject({
  source: SourceIdSchema,
  scope: IngestScopeSchema,
  snapshotPath: z
    .string()
    .min(1)
    .optional()
    .describe('Load a previously fetched raw snapshot instead of fetching'),
});
export type IngestRunInput = z.infer<typeof IngestRunInputSchema>;

/**
 * Receipt = the `ingest_run` row. Idempotency key is (source, adapterVersion,
 * snapshotChecksum): a repeat returns the original run with `deduplicated: true`.
 */
export const IngestRunReceiptSchema = z.object({
  runId: z.int(),
  operation: z.literal('ingest.run'),
  actor: z.literal('operator'),
  source: SourceIdSchema,
  scope: z.string(),
  adapterVersion: z.string(),
  snapshotChecksum: z.string().nullable(),
  status: z.enum(INGEST_STATUSES),
  deduplicated: z.boolean(),
  counts: z.record(z.string(), z.int()),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  readModelRefreshedBefore: IsoDateTimeSchema.nullable(),
  readModelRefreshedAfter: IsoDateTimeSchema.nullable(),
  error: z.string().nullable(),
});
export type IngestRunReceipt = z.infer<typeof IngestRunReceiptSchema>;

/** Error code when the per-source advisory lock is held (CapabilityError `conflict`). */
export const RUN_IN_PROGRESS = 'run_in_progress';

export const ingestRunContract = {
  name: 'ingest.run',
  version: 1,
  kind: 'write',
  audience: 'operator',
  summary: 'Fetch, parse and load one source; refresh read models on success.',
  input: IngestRunInputSchema,
  output: IngestRunReceiptSchema,
} as const;
