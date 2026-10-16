import {
  type ColumnDef,
  columnById,
  IDENTITY_SORTS,
  SCORECARD_PREFIX,
  type ScorecardColumn,
} from './explore-columns';
import type { ExploreState, SortTerm } from './explore-params';

export interface ExploreTableInput {
  filters: { chamber?: 'house' | 'senate'; state?: string; party?: string; q?: string };
  sort: { column: string; direction: 'asc' | 'desc' }[];
  limit: number;
  offset: number;
}

/**
 * Column id in the URL → core sort key (`total` → `totalReceiptsCents`). Scorecard ids
 * pass through unchanged; core rejects publishers whose terms are not cleared.
 */
export function sortKeyFor(id: string, scorecards: readonly ScorecardColumn[]): string | null {
  if (id.startsWith(SCORECARD_PREFIX)) return id;
  if (Object.hasOwn(IDENTITY_SORTS, id)) {
    return IDENTITY_SORTS[id as keyof typeof IDENTITY_SORTS].sortKey;
  }
  return columnById(id, scorecards)?.sortKey ?? null;
}

/** Sort terms the dataset can honor; unknown ids (e.g. a retired scorecard) are dropped. */
export function resolvedSort(
  sort: SortTerm[] | null,
  scorecards: readonly ScorecardColumn[],
): SortTerm[] {
  return (sort ?? []).filter((t) => sortKeyFor(t.id, scorecards) !== null);
}

export function exploreTableInput(state: ExploreState): ExploreTableInput {
  const q = state.q?.trim().slice(0, 100);
  const page = Math.max(1, state.page);
  return {
    filters: {
      ...(state.chamber ? { chamber: state.chamber } : {}),
      ...(state.state ? { state: state.state } : {}),
      ...(state.party ? { party: state.party.slice(0, 80) } : {}),
      ...(q ? { q } : {}),
    },
    sort: (state.sort ?? []).flatMap((t) => {
      const column = sortKeyFor(t.id, []);
      return column ? [{ column, direction: t.direction }] : [];
    }),
    limit: state.size,
    offset: Math.min((page - 1) * state.size, 100_000),
  };
}

/** Human description of the active sort, for captions and the results summary. */
export function describeSort(sort: SortTerm[], columns: readonly ColumnDef[]): string {
  if (sort.length === 0) return 'State, then name';
  return sort
    .map((t) => {
      const identity = Object.hasOwn(IDENTITY_SORTS, t.id)
        ? IDENTITY_SORTS[t.id as keyof typeof IDENTITY_SORTS].label
        : undefined;
      const label = identity ?? columns.find((c) => c.id === t.id)?.label ?? t.id;
      return `${label}, ${t.direction === 'asc' ? 'ascending' : 'descending'}`;
    })
    .join(', then ');
}
