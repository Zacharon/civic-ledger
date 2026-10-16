import { ALIGNED_POSITIONS } from '@civic-ledger/db';
import { z } from 'zod';
import { ChamberSchema, CongressSchema } from '../schemas/common';

export const BILL_TYPES = [
  'hr',
  's',
  'hjres',
  'sjres',
  'hconres',
  'sconres',
  'hres',
  'sres',
] as const;
export const BillTypeSchema = z.enum(BILL_TYPES);

export const RuleTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rollcall'),
    congress: CongressSchema,
    chamber: ChamberSchema,
    number: z.int().positive(),
  }),
  z
    .strictObject({
      kind: z.literal('bill'),
      congress: CongressSchema,
      billType: BillTypeSchema,
      number: z.int().positive(),
    })
    .describe("Resolves to the bill's final-passage rollcalls"),
]);
export type RuleTarget = z.infer<typeof RuleTargetSchema>;

export const FrameworkRuleSchema = z.strictObject({
  target: RuleTargetSchema,
  alignedPosition: z.enum(ALIGNED_POSITIONS),
  weight: z.number().positive().max(100).default(1),
  rationale: z.string().max(2000).optional().describe('Shown to readers; ignored by scoring'),
});

/** A framework travels whole in the request: user frameworks are never stored. */
export const FrameworkSpecSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  rules: z.array(FrameworkRuleSchema).min(1).max(200),
});
export type FrameworkSpec = z.output<typeof FrameworkSpecSchema>;
