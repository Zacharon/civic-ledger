import {
  createParser,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsNumberLiteral,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server';

/**
 * Explore URL state, shared by the server page (parse) and client controls
 * (`useQueryStates`). Every view of the table is a shareable URL.
 */

export interface SortTerm {
  /** Column id from explore-columns (`total`, `name`, `scorecard:<publisher>` …). */
  id: string;
  direction: 'asc' | 'desc';
}

const SORT_TERM = /^([a-z][a-zA-Z0-9]*|scorecard:[a-z0-9]+(?:-[a-z0-9]+)*)\.(asc|desc)$/;

/** `sort=total.desc,name.asc` (at most three terms, first wins on duplicates). */
export const parseAsSort = createParser<SortTerm[]>({
  parse(value) {
    const terms: SortTerm[] = [];
    for (const raw of value.split(',')) {
      const match = SORT_TERM.exec(raw.trim());
      if (!match?.[1] || !match[2]) continue;
      const id = match[1];
      if (terms.some((t) => t.id === id)) continue;
      terms.push({ id, direction: match[2] === 'asc' ? 'asc' : 'desc' });
    }
    return terms.length > 0 ? terms.slice(0, 3) : null;
  },
  serialize: (terms) => terms.map((t) => `${t.id}.${t.direction}`).join(','),
  eq: (a, b) =>
    a.length === b.length &&
    a.every((t, i) => t.id === b[i]?.id && t.direction === b[i]?.direction),
});

export const parseAsStateCode = createParser<string>({
  parse: (value) => (/^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null),
  serialize: (value) => value,
});

export const PAGE_SIZES = [25, 50, 100] as const;
export const CHAMBERS = ['house', 'senate'] as const;

export const exploreParsers = {
  q: parseAsString,
  chamber: parseAsStringLiteral(CHAMBERS),
  state: parseAsStateCode,
  party: parseAsString,
  sort: parseAsSort,
  cols: parseAsArrayOf(parseAsString, ','),
  page: parseAsInteger.withDefault(1),
  size: parseAsNumberLiteral(PAGE_SIZES).withDefault(50),
};

export const serializeExplore = createSerializer(exploreParsers);

export type ExploreState = {
  q: string | null;
  chamber: (typeof CHAMBERS)[number] | null;
  state: string | null;
  party: string | null;
  sort: SortTerm[] | null;
  cols: string[] | null;
  page: number;
  size: (typeof PAGE_SIZES)[number];
};

/** Next sort when a header is activated: first direction → the other → back to default. */
export function nextSort(
  current: SortTerm[] | null,
  id: string,
  firstDirection: 'asc' | 'desc',
): SortTerm[] | null {
  const primary = current?.[0];
  if (!primary || primary.id !== id) return [{ id, direction: firstDirection }];
  if (primary.direction === firstDirection) {
    return [{ id, direction: firstDirection === 'asc' ? 'desc' : 'asc' }];
  }
  return null;
}
