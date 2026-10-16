import { FrameworkSpecSchema } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { allColumns, visibleColumns } from '../src/lib/explore-columns';
import { exploreParsers, nextSort, parseAsSort, serializeExplore } from '../src/lib/explore-params';
import { describeSort, exploreTableInput } from '../src/lib/explore-query';
import { decodeRule, decodeRules, encodeRules, type RuleSpec } from '../src/lib/framework-url';

const scorecards = [
  {
    publisherId: 'sample-league',
    name: 'Sample League (fictional)',
    selfDescribedOrientation: 'nonpartisan',
    methodologyUrl: 'https://example.org/m',
  },
];

describe('Explore sort parameter', () => {
  it('parses up to three terms and drops junk and duplicates', () => {
    expect(parseAsSort.parse('total.desc,name.asc')).toEqual([
      { id: 'total', direction: 'desc' },
      { id: 'name', direction: 'asc' },
    ]);
    expect(parseAsSort.parse('a.asc,b.asc,c.asc,d.asc')).toHaveLength(3);
    expect(parseAsSort.parse('total.desc,total.asc')).toEqual([{ id: 'total', direction: 'desc' }]);
    expect(parseAsSort.parse('drop table;--.desc')).toBeNull();
    expect(parseAsSort.parse('scorecard:sample-league.asc')).toEqual([
      { id: 'scorecard:sample-league', direction: 'asc' },
    ]);
  });

  it('cycles a header: first direction → other → default', () => {
    expect(nextSort(null, 'total', 'desc')).toEqual([{ id: 'total', direction: 'desc' }]);
    expect(nextSort([{ id: 'total', direction: 'desc' }], 'total', 'desc')).toEqual([
      { id: 'total', direction: 'asc' },
    ]);
    expect(nextSort([{ id: 'total', direction: 'asc' }], 'total', 'desc')).toBeNull();
    expect(nextSort([{ id: 'total', direction: 'asc' }], 'pac', 'desc')).toEqual([
      { id: 'pac', direction: 'desc' },
    ]);
  });

  it('round-trips the whole state through a URL', () => {
    const url = serializeExplore('/explore', {
      q: 'Ash vale',
      chamber: 'senate',
      state: 'ZV',
      sort: [{ id: 'pac', direction: 'desc' }],
      cols: ['total', 'pac'],
      page: 2,
      size: 25,
    });
    const params = new URL(url, 'http://x').searchParams;
    expect(exploreParsers.q.parse(params.get('q') ?? '')).toBe('Ash vale');
    expect(parseAsSort.parse(params.get('sort') ?? '')).toEqual([{ id: 'pac', direction: 'desc' }]);
    expect(params.get('cols')).toBe('total,pac');
    expect(params.get('page')).toBe('2');
    // Defaults are omitted, so the canonical URL stays short.
    expect(serializeExplore('/explore', { page: 1, size: 50 })).toBe('/explore');
  });
});

describe('Explore → explore.table input', () => {
  const base = {
    q: null,
    chamber: null,
    state: null,
    party: null,
    sort: null,
    cols: null,
    page: 1,
    size: 50,
  } as const;

  it('defaults to the neutral order (no sort terms) and page 1', () => {
    expect(exploreTableInput(base)).toEqual({ filters: {}, sort: [], limit: 50, offset: 0 });
    expect(describeSort([], [])).toBe('State, then name');
  });

  it('maps URL column ids to core sort keys and pages to offsets', () => {
    const input = exploreTableInput({
      ...base,
      q: '  Ash  ',
      chamber: 'house',
      sort: [
        { id: 'total', direction: 'desc' },
        { id: 'name', direction: 'asc' },
        { id: 'scorecard:sample-league', direction: 'asc' },
      ],
      page: 3,
      size: 25,
    });
    expect(input).toEqual({
      filters: { chamber: 'house', q: 'Ash' },
      sort: [
        { column: 'totalReceiptsCents', direction: 'desc' },
        { column: 'sortName', direction: 'asc' },
        { column: 'scorecard:sample-league', direction: 'asc' },
      ],
      limit: 25,
      offset: 50,
    });
  });

  it('drops unknown sort ids instead of sending them to core', () => {
    expect(exploreTableInput({ ...base, sort: [{ id: 'nope', direction: 'asc' }] }).sort).toEqual(
      [],
    );
  });

  it('shows defaults, every scorecard, and exactly the chosen columns', () => {
    const defaults = visibleColumns(null, scorecards).map((c) => c.id);
    expect(defaults).toContain('scorecard:sample-league');
    expect(defaults).not.toContain('dim2');
    expect(visibleColumns(['pac', 'total'], scorecards).map((c) => c.id)).toEqual(['total', 'pac']);
    const groups = allColumns(scorecards).map((c) => c.group);
    expect(groups.indexOf('scorecards')).toBeLessThan(groups.indexOf('promises'));
  });
});

describe('framework spec in the URL', () => {
  const rules: RuleSpec[] = [
    {
      target: { kind: 'rollcall', congress: 119, chamber: 'house', number: 12 },
      alignedPosition: 'yea',
    },
    {
      target: { kind: 'bill', congress: 119, billType: 'hr', number: 99001 },
      alignedPosition: 'nay',
      weight: 2,
    },
  ];

  it('encodes compactly and decodes to the same rules', () => {
    const encoded = encodeRules(rules);
    expect(encoded).toBe('119.house.12.yea,119.hr.99001.nay.w2');
    expect(decodeRules(encoded)).toEqual(rules);
  });

  it('decodes to specs that core accepts', () => {
    const spec = { title: 'T', rules: decodeRules('119.senate.3.nay,119.s.99002.yea') };
    expect(FrameworkSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('ignores malformed tokens and duplicate targets', () => {
    expect(decodeRule('119.lords.1.yea')).toBeNull();
    expect(decodeRule('119.house.0.yea')).toBeNull();
    expect(decodeRule('119.house.1.maybe')).toBeNull();
    expect(decodeRule('119.house.1.yea.w0')).toBeNull();
    expect(decodeRule('<script>')).toBeNull();
    expect(decodeRules('119.house.1.yea,119.house.1.nay,junk')).toEqual([
      {
        target: { kind: 'rollcall', congress: 119, chamber: 'house', number: 1 },
        alignedPosition: 'yea',
      },
    ]);
    expect(decodeRules(null)).toEqual([]);
  });
});
