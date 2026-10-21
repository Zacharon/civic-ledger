import { districtMap, personCard } from '@civic-ledger/db';
import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { notFound } from '../errors';
import {
  CongressSchema,
  IsoDateSchema,
  ProvenanceSchema,
  SlugSchema,
  StateCodeSchema,
} from '../schemas/common';
import { provenanceFields, withProvenance } from '../schemas/provenance';
import { isCurrentMember } from './person-card';

// districts.shape@1 ----------------------------------------------------------

/**
 * The Congress sitting on `date` (ISO): the 1st began 1789-01-03 and each lasts two years from
 * January 3 of an odd year. A term that begins 2027-01-03 belongs to the 120th, so its district
 * number is not on a 119th-Congress map.
 */
export function congressOfDate(date: string): number {
  const year = Number(date.slice(0, 4));
  const beforeJan3 = date.slice(5) < '01-03';
  const startYear = year % 2 === 1 ? (beforeJan3 ? year - 2 : year) : year - 1;
  return (startYear - 1789) / 2 + 1;
}

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** The District of Columbia and the territories: "state" would be the wrong word. */
const NOT_STATES = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);

/**
 * SVG path data as the ingest writes it: absolute `M`/`L`, relative `l`, closed with `Z`,
 * numbers only. A stored path that does not fit is refused at load and again here, so nothing
 * but drawing commands can reach the page.
 */
export const PATH_DATA_PATTERN = /^[MLlZ0-9. -]+$/;
export const PATH_DATA_MAX_LENGTH = 60_000;
export const PathDataSchema = z
  .string()
  .max(PATH_DATA_MAX_LENGTH)
  .regex(PATH_DATA_PATTERN, 'SVG path data: M, L, l, Z, digits, dots, minus and spaces only');

const nthOrdinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
};

export const DistrictsShapeInput = z
  .strictObject({
    slug: SlugSchema.optional().describe(
      'Member mode: draw the seat of this member. Only a current member is mapped; a House district is drawn only when the member term began in the Congress the boundaries are for. Do not combine with `state` or `district`.',
    ),
    state: StateCodeSchema.optional().describe(
      'Place mode: two-letter state or territory code, e.g. GA',
    ),
    district: z
      .int()
      .min(0)
      .max(99)
      .optional()
      .describe(
        'Place mode: House district number in the boundary Congress. Omit it (a Senate seat) or pass 0 (an at-large seat or a delegate) for the whole state; 0 is refused for a state that has numbered districts.',
      ),
  })
  .refine(
    (v) =>
      (v.slug !== undefined) !== (v.state !== undefined) && !(v.slug && v.district !== undefined),
    { message: 'Give either `slug`, or `state` with an optional `district`' },
  );

export const DistrictsShapeOutput = z.object({
  state: StateCodeSchema,
  stateName: z.string(),
  district: z
    .int()
    .nullable()
    .describe(
      'The district drawn, as asked or as the member holds it; null for a Senate seat or a place request without one',
    ),
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
  statePath: PathDataSchema.describe(
    'SVG path data for the state outline, projected into the viewBox',
  ),
  districtPath: PathDataSchema.nullable().describe(
    'SVG path data for the highlighted district; null when `scope` is `state`',
  ),
  congress: CongressSchema.describe('The Congress whose district lines these are'),
  vintage: z.string().describe('Which boundary file the shapes come from'),
  publisher: z.string().describe('Who published the boundaries'),
  asOf: IsoDateSchema.describe('Date the district lines are current to'),
  caveat: z.string().describe('What this vintage does not show; display it with the map'),
  provenance: ProvenanceSchema.describe(
    'Source of the drawn shape (the district row, or the outline for a whole-state map)',
  ),
  stateProvenance: ProvenanceSchema.describe('Source of the state outline'),
});

export const districtsShape = defineCapability({
  name: 'districts.shape',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary:
    'Locator-map geometry: a state outline and one congressional district as SVG paths, with the boundary Congress, vintage and as-of date. Ask by member (`slug`: current members only; a House district only when the term began in the boundary Congress) or by place (`state`, `district`).',
  input: DistrictsShapeInput,
  output: DistrictsShapeOutput,
  async handler({ db }, input) {
    let state: string;
    let district: number | null = input.district ?? null;
    let memberCongress: number | null = null;

    if (input.slug !== undefined) {
      const [member] = await db
        .select({
          state: personCard.state,
          chamber: personCard.chamber,
          district: personCard.district,
          termStart: personCard.termStart,
          isCurrent: isCurrentMember,
        })
        .from(personCard)
        .where(eq(personCard.slug, input.slug))
        .limit(1);
      if (!member) throw notFound(`No member "${input.slug}"`);
      if (!member.isCurrent) {
        throw notFound(
          "Maps are drawn for current members only: a former member's district number can mean a different area",
        );
      }
      if (!member.state || !member.chamber) throw notFound('This member has no seat on record');
      state = member.state;
      if (member.chamber === 'senate') {
        district = null;
      } else {
        if (member.district === null) {
          throw notFound('This House seat has no district number on record, so no map is drawn');
        }
        if (!member.termStart) throw notFound('This member has no term start on record');
        district = member.district;
        if (member.district > 0) memberCongress = congressOfDate(member.termStart);
      }
    } else {
      state = input.state as string;
    }

    const wanted = district !== null && district > 0 ? district : null;
    const rows = await db
      .select({
        district: districtMap.district,
        stateName: districtMap.stateName,
        width: districtMap.viewBoxWidth,
        height: districtMap.viewBoxHeight,
        path: districtMap.path,
        congress: districtMap.congress,
        vintage: districtMap.vintage,
        publisher: districtMap.publisher,
        asOf: districtMap.asOf,
        ...provenanceFields(districtMap),
      })
      .from(districtMap)
      .where(
        and(
          eq(districtMap.state, state),
          wanted === null
            ? isNull(districtMap.district)
            : or(isNull(districtMap.district), eq(districtMap.district, wanted)),
        ),
      )
      .orderBy(asc(districtMap.district));
    const outline = rows.find((r) => r.district === null);
    if (!outline) throw notFound(`No map for state "${state}"`);

    if (district === 0) {
      // At-large seats and delegates are the whole state; a state with numbered districts has none.
      const [numbered] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(districtMap)
        .where(and(eq(districtMap.state, state), isNotNull(districtMap.district)));
      if ((numbered?.n ?? 0) > 0) {
        throw notFound(
          `${state} has numbered districts in this boundary vintage, so district 0 (at-large) is not valid`,
        );
      }
    }
    const shape = wanted === null ? undefined : rows.find((r) => r.district === wanted);
    if (wanted !== null && !shape) {
      throw notFound(`No map for district ${wanted} of ${state} in this boundary vintage`);
    }
    if (shape && memberCongress !== null && memberCongress !== shape.congress) {
      throw notFound(
        `This member's term began in the ${nthOrdinal(memberCongress)} Congress, but these district lines are for the ${nthOrdinal(shape.congress)}; no map is drawn`,
      );
    }

    const provenanceOf = (r: (typeof rows)[number]) =>
      withProvenance({
        sourceId: r.sourceId,
        sourceKey: r.sourceKey,
        ingestRunId: r.ingestRunId,
        retrievedAt: r.retrievedAt,
      }).provenance;
    return {
      state,
      stateName: outline.stateName,
      district,
      scope: shape ? ('district' as const) : ('state' as const),
      description: shape
        ? `Map of ${outline.stateName} with congressional district ${wanted} highlighted`
        : `Map of ${outline.stateName} with the whole ${NOT_STATES.has(state) ? 'area' : 'state'} highlighted`,
      viewBox: `0 0 ${outline.width} ${outline.height}`,
      width: outline.width,
      height: outline.height,
      statePath: outline.path,
      districtPath: shape?.path ?? null,
      congress: outline.congress,
      vintage: outline.vintage,
      publisher: outline.publisher,
      asOf: outline.asOf,
      caveat: `Shows district lines as of ${longDate(outline.asOf)}. A state that redrew its districts after that date is not reflected.`,
      provenance: provenanceOf(shape ?? outline),
      stateProvenance: provenanceOf(outline),
    };
  },
});
