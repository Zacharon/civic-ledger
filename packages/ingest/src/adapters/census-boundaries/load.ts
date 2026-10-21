import { PATH_DATA_MAX_LENGTH, PATH_DATA_PATTERN } from '@civic-ledger/core';
import { conflictUpdateSet, districtMap } from '@civic-ledger/db';
import { and, eq, ne } from 'drizzle-orm';
import type { LoadContext, LoadCounts } from '../../adapter';
import { provenance } from '../../runtime/batch';
import { Counts } from '../../runtime/counts';
import type { BoundaryRecord } from './parse';

/** Writes one state outline and its numbered districts per record; stale shapes are swept. */
export async function loadBoundaries(
  records: AsyncIterable<BoundaryRecord>,
  ctx: LoadContext,
): Promise<LoadCounts> {
  const counts = new Counts([
    'shapes',
    'states',
    'districts',
    'whole_state_districts',
    'vertices_in',
    'vertices_out',
    'rings_dropped',
    'stale_shapes_deleted',
  ] as const);

  for await (const r of records) {
    ctx.checkpoint?.();
    const base = {
      state: r.state,
      stateName: r.stateName,
      viewBoxWidth: r.width,
      viewBoxHeight: r.height,
      vintage: r.vintage,
      publisher: r.publisher,
      asOf: r.asOf,
      congress: r.congress,
    };
    for (const [label, path] of [
      [`${r.state} outline`, r.statePath],
      ...r.districts.map((d) => [`${r.state}-${d.district}`, d.path] as const),
    ] as const) {
      if (path.length > PATH_DATA_MAX_LENGTH || !PATH_DATA_PATTERN.test(path)) {
        throw new Error(
          `${label}: generated path data is not plain drawing commands within ${PATH_DATA_MAX_LENGTH} characters`,
        );
      }
    }
    const rows = [
      { ...base, district: null, path: r.statePath, ...provenance(ctx, r.stateSourceKey) },
      ...r.districts.map((d) => ({
        ...base,
        district: d.district,
        path: d.path,
        ...provenance(ctx, d.sourceKey),
      })),
    ];
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(districtMap)
        .values(rows)
        .onConflictDoUpdate({
          target: [districtMap.state, districtMap.district],
          set: conflictUpdateSet(districtMap),
        });
    });
    counts.add('shapes', rows.length);
    counts.add('states');
    counts.add('districts', r.districts.length);
    counts.add('whole_state_districts', r.wholeStateDistricts);
    counts.add('vertices_in', r.stats.verticesIn);
    counts.add('vertices_out', r.stats.verticesOut);
    counts.add('rings_dropped', r.stats.ringsDropped);
  }

  // The two files are the complete boundary set: a shape this source wrote earlier and did
  // not write now (a district that no longer exists, an unmapped territory) is stale.
  const stale = await ctx.db
    .delete(districtMap)
    .where(
      and(eq(districtMap.sourceId, ctx.sourceId), ne(districtMap.ingestRunId, ctx.ingestRunId)),
    )
    .returning({ id: districtMap.id });
  counts.set('stale_shapes_deleted', stale.length);
  return counts.toJSON();
}
