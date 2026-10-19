/**
 * The members chosen for Compare travel in the URL, like every other view state: `ids=`
 * on /compare, `compare=` on Explore and profiles. Browsing the table and opening
 * profiles keeps the list, so each "Add to comparison" adds to it instead of starting over.
 */

export const COMPARE_MAX = 4;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Comma-separated slugs: lower-cased, invalid ones dropped, de-duplicated, at most four. */
export function parseCompareIds(value: string | null | undefined): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG.test(s) && s.length <= 120);
  return [...new Set(ids)].slice(0, COMPARE_MAX);
}

export const compareHref = (ids: readonly string[]) =>
  ids.length > 0 ? `/compare?ids=${ids.join(',')}` : '/compare';

/** A profile link that keeps the comparison in progress. */
export const profileHref = (slug: string, ids: readonly string[] | null | undefined) =>
  ids && ids.length > 0 ? `/people/${slug}?compare=${ids.join(',')}` : `/people/${slug}`;

/** Explore with the comparison in progress (and any other query already built). */
export function exploreHref(ids: readonly string[], query = ''): string {
  const params = new URLSearchParams(query);
  if (ids.length > 0) params.set('compare', ids.join(','));
  const search = params.toString().replaceAll('%2C', ',');
  return search ? `/explore?${search}` : '/explore';
}
