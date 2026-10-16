import { z } from 'zod';
import { defineCapability } from '../capability';
import { CURATED_KINDS } from '../curated/schemas';
import { validateCuratedFile } from '../curated/validate';

export const CuratedValidateInput = z.strictObject({
  files: z
    .array(z.strictObject({ path: z.string().min(1).max(500), content: z.string().max(1_000_000) }))
    .min(1)
    .max(500),
});

export const CuratedValidateOutput = z.object({
  valid: z.boolean(),
  files: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(CURATED_KINDS).nullable(),
      issues: z.array(
        z.object({ line: z.int().nullable(), path: z.string(), message: z.string() }),
      ),
    }),
  ),
});

/** Pure validation of proposed curated files; touches neither disk nor database. */
export const curatedValidate = defineCapability({
  name: 'curated.validate',
  version: 1,
  kind: 'read',
  audience: 'operator',
  summary:
    'Validate curated YAML (promises, platforms, frameworks, industry map) with file:line issues.',
  input: CuratedValidateInput,
  output: CuratedValidateOutput,
  async handler(_ctx, { files }) {
    const results = files.map(validateCuratedFile);
    return { valid: results.every((r) => r.issues.length === 0), files: results };
  },
});
