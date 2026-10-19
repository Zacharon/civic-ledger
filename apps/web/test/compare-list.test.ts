import { describe, expect, it } from 'vitest';
import {
  COMPARE_MAX,
  compareHref,
  exploreHref,
  parseCompareIds,
  profileHref,
} from '../src/lib/compare-list';
import { exploreParsers, serializeExplore } from '../src/lib/explore-params';

describe('comparison carried in the URL', () => {
  it('parses slugs: lower-cased, invalid dropped, de-duplicated, at most four', () => {
    expect(parseCompareIds('Avery-Ashvale, blair-brindlemoor,avery-ashvale')).toEqual([
      'avery-ashvale',
      'blair-brindlemoor',
    ]);
    expect(parseCompareIds('a,b,c,d,e')).toHaveLength(COMPARE_MAX);
    expect(parseCompareIds('../etc,<x>,ok-1')).toEqual(['ok-1']);
    expect(parseCompareIds(undefined)).toEqual([]);
  });

  it('builds compare, profile and explore links that keep the list', () => {
    expect(compareHref([])).toBe('/compare');
    expect(compareHref(['a', 'b'])).toBe('/compare?ids=a,b');
    expect(profileHref('c', null)).toBe('/people/c');
    expect(profileHref('c', ['a', 'b'])).toBe('/people/c?compare=a,b');
    expect(exploreHref([])).toBe('/explore');
    expect(exploreHref(['a', 'b'])).toBe('/explore?compare=a,b');
    expect(exploreHref(['a'], 'q=Ashvale')).toBe('/explore?q=Ashvale&compare=a');
  });

  it('survives Explore sorting and paging links', () => {
    const href = serializeExplore('/explore', {
      compare: ['a', 'b'],
      sort: [{ id: 'total', direction: 'desc' }],
      page: 2,
    });
    expect(href).toContain('compare=a,b');
    expect(exploreParsers.compare.parse('a,b,a')).toEqual(['a', 'b']);
    expect(exploreParsers.compare.parse('!!')).toBeNull();
  });
});
