import { describe, expect, it } from 'vitest';
import {
  agreementHref,
  agreementSentence,
  compareHref,
  disagreementsLinkText,
  exclusionText,
  parseAgreementFilter,
  parsePeriod,
  votesPeriodLabel,
} from '../src/lib/compare-list';

/** T-S2a: the comparison period and the agreement drilldown travel in the URL. */
describe('comparison period in the URL', () => {
  it('keeps the period on compare links and leaves the v1 link unchanged without one', () => {
    expect(compareHref(['a', 'b'])).toBe('/compare?ids=a,b');
    expect(compareHref(['a', 'b'], { congress: null, cycle: null })).toBe('/compare?ids=a,b');
    expect(compareHref(['a', 'b'], { congress: 118, cycle: 2022 })).toBe(
      '/compare?ids=a,b&congress=118&cycle=2022',
    );
    expect(compareHref([], { congress: 118, cycle: null })).toBe('/compare?congress=118');
  });

  it('parses only valid Congress numbers and FEC cycles; anything else means no period', () => {
    expect(parsePeriod({ congress: '118', cycle: '2022' })).toEqual({ congress: 118, cycle: 2022 });
    expect(parsePeriod({ congress: ['116', '118'], cycle: undefined })).toEqual({
      congress: 116,
      cycle: null,
    });
    for (const bad of ['0', '201', 'x', '118.5', '-1', '', '1e2']) {
      expect(parsePeriod({ congress: bad, cycle: bad }), bad).toEqual({
        congress: null,
        cycle: null,
      });
    }
    expect(parsePeriod({ congress: undefined, cycle: '1800' })).toEqual({
      congress: null,
      cycle: null,
    });
  });

  it('parses the drilldown filter, defaulting to all', () => {
    expect(parseAgreementFilter('disagreed')).toBe('disagreed');
    expect(parseAgreementFilter('excluded')).toBe('excluded');
    expect(parseAgreementFilter('nope')).toBe('all');
    expect(parseAgreementFilter(undefined)).toBe('all');
  });
});

describe('agreement drilldown links', () => {
  it('encode the pair, the comparison, the period and the filter; defaults are omitted', () => {
    expect(
      agreementHref({
        a: 'x',
        b: 'y',
        ids: ['x', 'y', 'z'],
        congress: 118,
        filter: 'disagreed',
        page: 2,
      }),
    ).toBe('/compare/agreement?a=x&b=y&ids=x,y,z&congress=118&filter=disagreed&page=2');
    expect(agreementHref({ a: 'x', b: 'y', filter: 'all', page: 1 })).toBe(
      '/compare/agreement?a=x&b=y',
    );
  });

  it('pagination preserves the filter, the period and the comparison on every page', () => {
    const base = { a: 'x', b: 'y', ids: ['x', 'y'], congress: 116, filter: 'excluded' as const };
    for (const page of [1, 2, 3, 9]) {
      const url = new URL(agreementHref({ ...base, page }), 'http://test');
      expect(url.pathname).toBe('/compare/agreement');
      expect(url.searchParams.get('a')).toBe('x');
      expect(url.searchParams.get('b')).toBe('y');
      expect(url.searchParams.get('ids')).toBe('x,y');
      expect(url.searchParams.get('congress')).toBe('116');
      expect(url.searchParams.get('filter')).toBe('excluded');
      expect(url.searchParams.get('page')).toBe(page === 1 ? null : String(page));
    }
  });
});

describe('agreement wording', () => {
  it('names the period', () => {
    expect(votesPeriodLabel({ basis: 'congress', congress: 118 })).toBe('the 118th Congress');
    expect(votesPeriodLabel({ basis: 'all_loaded', congress: null })).toBe('all loaded history');
  });

  it('always states the denominator, including tiny ones, never a bare percentage', () => {
    expect(agreementSentence(1, 1, 'the 118th Congress')).toBe(
      'Agreed on 1 of 1 shared recorded vote in the 118th Congress.',
    );
    expect(agreementSentence(2, 4, 'all loaded history')).toBe(
      'Agreed on 2 of 4 shared recorded votes in all loaded history.',
    );
    expect(agreementSentence(1200, 1500, 'all loaded history')).toBe(
      'Agreed on 1,200 of 1,500 shared recorded votes in all loaded history.',
    );
    expect(agreementSentence(0, 0, 'the 116th Congress')).toBe(
      'No shared recorded votes in the 116th Congress.',
    );
  });

  it('counts disagreements in the link text', () => {
    expect(disagreementsLinkText(1)).toBe('Open the 1 disagreement');
    expect(disagreementsLinkText(12)).toBe('Open the 12 disagreements');
  });
});

describe('exclusion wording', () => {
  it('lists only the reasons that occurred, in a fixed order', () => {
    expect(
      exclusionText({ total: 0, notServing: 0, unavailable: 0, notVoting: 0, present: 0 }),
    ).toBeNull();
    expect(
      exclusionText({ total: 5, notServing: 3, unavailable: 1, notVoting: 1, present: 0 }),
    ).toBe(
      'Not counted: 1 not voting, 1 serving but no vote record stored, 3 not serving in that chamber.',
    );
  });
});
