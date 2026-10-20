import { districtMap } from '@civic-ledger/db';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import { IsoDateSchema, ProvenanceSchema, StateCodeSchema } from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';

// districts.shape@1 ----------------------------------------------------------

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

export const DistrictsShapeInput = z.strictObject({
  state: StateCodeSchema.describe('Two-letter state or territory code, e.g. GA'),
  district: z
    .int()
    .min(0)
    .max(99)
    .optional()
    .describe(
      'House district number. Omit it (a Senate seat), or pass 0 (an at-large seat or a delegate), for the whole state.',
    ),
});

export const DistrictsShapeOutput = z.object({
  state: StateCodeSchema,
  stateName: z.string(),
  district: z.int().nullable().describe('The requested district; null when none was requested'),
  scope: z
    .enum(['district', 'state'])
    .describe('`district`: one numbered district is highlighted; `state`: the whole state is.'),
  description: z
    .string()
    .describe(
      'Accessible name for the map, e.g. "Map of Georgia with congressional district 10 highlighted"',
    ),
  viewBox: z.string().describe('SVG viewBox, `0 0 <width> <height>`'),
  width: z.int().positive().describe('Intrinsic map width in CSS pixels'),
  height: z.int().positive().describe('Intrinsic map height in CSS pixels'),
  statePath: z.string().describe('SVG path data for the state outline, projected into the viewBox'),
  districtPath: z
    .string()
    .nullable()
    .describe('SVG path data for the highlighted district; null when `scope` is `state`'),
  vintage: z.string().describe('Which boundary file the shapes come from'),
  publisher: z.string().describe('Who published the boundaries'),
  asOf: IsoDateSchema.describe('Date the district lines are current to'),
  caveat: z.string().describe('What this vintage does not show; display it with the map'),
  provenance: ProvenanceSchema,
});

export const districtsShape = defineCapability({
  name: 'districts.shape',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Locator-map geometry: a state outline and one congressional district as SVG paths, with the boundary vintage and its as-of date.',
  input: DistrictsShapeInput,
  output: DistrictsShapeOutput,
  async handler({ db }, input) {
    const wanted = input.district !== undefined && input.district > 0 ? input.district : null;
    const rows = await db
      .select({
        district: districtMap.district,
        stateName: districtMap.stateName,
        width: districtMap.viewBoxWidth,
        height: districtMap.viewBoxHeight,
        path: districtMap.path,
        vintage: districtMap.vintage,
        publisher: districtMap.publisher,
        asOf: districtMap.asOf,
        ...provenanceFields(districtMap),
      })
      .from(districtMap)
      .where(
        and(
          eq(districtMap.state, input.state),
          wanted === null
            ? isNull(districtMap.district)
            : or(isNull(districtMap.district), eq(districtMap.district, wanted)),
        ),
      )
      .orderBy(asc(districtMap.district));
    const state = rows.find((r) => r.district === null);
    if (!state) throw notFound(`No map for state "${input.state}"`);
    const district = wanted === null ? undefined : rows.find((r) => r.district === wanted);
    if (wanted !== null && !district) {
      throw notFound(`No map for district ${wanted} of ${input.state} in this boundary vintage`);
    }
    const source = district ?? state;
    const { provenance } = withProvenance({
      sourceId: source.sourceId,
      sourceKey: source.sourceKey,
      ingestRunId: source.ingestRunId,
      retrievedAt: source.retrievedAt,
    });
    return {
      state: input.state,
      stateName: state.stateName,
      district: input.district ?? null,
      scope: district ? ('district' as const) : ('state' as const),
      description: district
        ? `Map of ${state.stateName} with congressional district ${wanted} highlighted`
        : `Map of ${state.stateName} with the whole state highlighted`,
      viewBox: `0 0 ${state.width} ${state.height}`,
      width: state.width,
      height: state.height,
      statePath: state.path,
      districtPath: district?.path ?? null,
      vintage: state.vintage,
      publisher: state.publisher,
      asOf: state.asOf,
      caveat: `Shows district lines as of ${longDate(state.asOf)}. A state that redrew its districts after that date is not reflected.`,
      provenance,
    };
  },
});
