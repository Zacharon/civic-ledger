import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { EXPLAINERS, explainerById } from '../explainers/content';

const ExplainerIdSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lowercase kebab-case id');

export const ExplainersListInput = z.strictObject({
  id: ExplainerIdSchema.optional().describe('One explainer; omit for all'),
});

export const ExplainerSchema = z.object({
  id: ExplainerIdSchema,
  question: z.string(),
  answer: z.array(z.string()).describe('Plain-text paragraphs'),
  source: z.object({
    name: z.string(),
    url: z
      .string()
      .describe('Absolute URL of the authority, or a site-relative methodology anchor'),
  }),
  appearsIn: z.array(z.string()).describe('Ledger figures and sections that use the term'),
  /** Site-relative anchor where the explainer is rendered for people. */
  href: z.string(),
});

export const ExplainersListOutput = z.object({
  items: z.array(ExplainerSchema),
});

export const explainerHref = (id: string) => `/methodology#explainer-${id}`;

export const explainersList = defineCapability({
  name: 'explainers.list',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Plain-language explainers of ledger terms (PAC, small-dollar donors, DW-NOMINATE, outside spending, roll call, framework, industry coding, "not coded"), each citing its authoritative source.',
  input: ExplainersListInput,
  output: ExplainersListOutput,
  async handler(_ctx, { id }) {
    if (id !== undefined) {
      const one = explainerById(id);
      if (!one) throw notFound(`No explainer "${id}"`);
      return {
        items: [
          {
            ...one,
            answer: [...one.answer],
            appearsIn: [...one.appearsIn],
            href: explainerHref(one.id),
          },
        ],
      };
    }
    return {
      items: EXPLAINERS.map((e) => ({
        ...e,
        answer: [...e.answer],
        appearsIn: [...e.appearsIn],
        href: explainerHref(e.id),
      })),
    };
  },
});
