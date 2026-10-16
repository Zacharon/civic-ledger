import { PROMISE_STATUSES, person, policyArea, promise, promiseRating } from '@civic-ledger/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  IsoDateSchema,
  PersonRefSchema,
  PolicyAreaRefSchema,
  ProvenanceSchema,
  ShareSchema,
  SlugSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

/** Statuses that count as a verdict in the kept rate; the rest are still open. */
const RATED_STATUSES = new Set(['kept', 'compromise', 'broken']);

const PromiseStatusSchema = z.enum(PROMISE_STATUSES);

export const PromisesListInput = z.strictObject({
  slug: SlugSchema,
  status: PromiseStatusSchema.optional().describe("Filter by the latest rating's status"),
});

export const PromisesListOutput = z.object({
  person: PersonRefSchema,
  summary: z.object({
    total: z.int(),
    rated: z.int().describe('Latest rating is kept, compromise or broken'),
    kept: z.int(),
    keptRate: ShareSchema.nullable(),
  }),
  items: z.array(
    z.object({
      promiseKey: z.string(),
      statement: z.string(),
      madeOn: IsoDateSchema.nullable(),
      policyArea: PolicyAreaRefSchema.nullable(),
      sourceUrl: z.url(),
      status: PromiseStatusSchema.describe('Status of the most recent rating'),
      provenance: ProvenanceSchema,
      ratings: z.array(
        z.object({
          rater: z.string(),
          status: PromiseStatusSchema,
          ratedOn: IsoDateSchema,
          summary: z.string().nullable(),
          evidence: z.array(
            z.object({ url: z.url(), title: z.string(), note: z.string().optional() }),
          ),
          provenance: ProvenanceSchema,
        }),
      ),
    }),
  ),
});

export const promisesList = defineCapability({
  name: 'promises.list',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Campaign promises with dated ratings and evidence links (curated, git-reviewed).',
  input: PromisesListInput,
  output: PromisesListOutput,
  async handler({ db }, input) {
    const [who] = await db
      .select({ id: person.id, slug: person.slug, fullName: person.fullName })
      .from(person)
      .where(eq(person.slug, input.slug))
      .limit(1);
    if (!who) throw notFound(`No person with slug "${input.slug}"`);

    const promises = await db
      .select({
        id: promise.id,
        promiseKey: promise.promiseKey,
        statement: promise.statement,
        madeOn: promise.madeOn,
        sourceUrl: promise.sourceUrl,
        policyAreaId: policyArea.id,
        policyAreaName: policyArea.name,
        ...provenanceFields(promise),
      })
      .from(promise)
      .leftJoin(policyArea, eq(policyArea.id, promise.policyAreaId))
      .where(eq(promise.personId, who.id))
      .orderBy(desc(promise.madeOn), asc(promise.promiseKey));

    const ratings =
      promises.length === 0
        ? []
        : await db
            .select({
              promiseId: promiseRating.promiseId,
              rater: promiseRating.rater,
              status: promiseRating.status,
              ratedOn: promiseRating.ratedOn,
              summary: promiseRating.summary,
              evidence: promiseRating.evidence,
              ...provenanceFields(promiseRating),
            })
            .from(promiseRating)
            .where(
              inArray(
                promiseRating.promiseId,
                promises.map((p) => p.id),
              ),
            )
            .orderBy(desc(promiseRating.ratedOn), asc(promiseRating.rater));

    const items = promises.map(({ id, policyAreaId, policyAreaName, ...p }) => {
      const own = ratings
        .filter((r) => r.promiseId === id)
        .map(({ promiseId: _, ...r }) => withProvenance(r));
      return {
        ...withProvenance(p),
        policyArea:
          policyAreaId === null || policyAreaName === null
            ? null
            : { id: policyAreaId, name: policyAreaName },
        status: own[0]?.status ?? 'not_yet_rated',
        ratings: own,
      };
    });
    const rated = items.filter((i) => RATED_STATUSES.has(i.status));
    const kept = rated.filter((i) => i.status === 'kept').length;
    return {
      person: { slug: who.slug, fullName: who.fullName },
      summary: {
        total: items.length,
        rated: rated.length,
        kept,
        keptRate: rated.length > 0 ? kept / rated.length : null,
      },
      items: input.status ? items.filter((i) => i.status === input.status) : items,
    };
  },
});
