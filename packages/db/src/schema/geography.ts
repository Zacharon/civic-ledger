import { date, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { provenanceColumns, provenanceIndexes } from './provenance';

/**
 * Precomputed locator-map geometry (DECISIONS A75): one row per state outline
 * (`district` null) and one per numbered congressional district. A state's rows share one
 * `view_box`. At-large seats and delegate districts have no row of their own; they are the
 * whole state (`district` 0 in `office`, `98` in the Census file).
 *
 * `congress` says which Congress's districts the numbers mean: a member's district number
 * is only drawn on a map of the same Congress (DECISIONS A80).
 *
 * `path` is an SVG path (`d` attribute) already projected and simplified for a map about
 * 240 px wide, so the web side only inlines it. `vintage`, `publisher` and `as_of` say
 * which boundary file the shape came from and the date its district lines are current to;
 * they are stored per row because the fictional seed and the Census files differ.
 */
export const districtMap = pgTable(
  'district_map',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    state: text('state').notNull(),
    stateName: text('state_name').notNull(),
    district: integer('district'),
    /** Congress whose district lines these are (119 for the Census 2025 files). */
    congress: integer('congress').notNull(),
    viewBoxWidth: integer('view_box_width').notNull(),
    viewBoxHeight: integer('view_box_height').notNull(),
    path: text('path').notNull(),
    vintage: text('vintage').notNull(),
    publisher: text('publisher').notNull(),
    asOf: date('as_of').notNull(),
    ...provenanceColumns(),
  },
  (t) => [
    unique('district_map_natural_key').on(t.state, t.district).nullsNotDistinct(),
    ...provenanceIndexes('district_map', t),
  ],
);
