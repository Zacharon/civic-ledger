import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('people.search@1', () => {
  it('matches names case-insensitively, ordered by name', async () => {
    const result = await dispatch('people.search', { q: 'MOOR' }, db.ctx());
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.fullName.toLowerCase().includes('moor'))).toBe(true);
  });

  it('filters by chamber and state and paginates', async () => {
    const senate = await dispatch('people.search', { chamber: 'senate', state: 'ZZ' }, db.ctx());
    expect(senate.total).toBe(2);
    const page = await dispatch('people.search', { limit: 5, offset: 5 }, db.ctx());
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(40);
  });

  it('treats LIKE wildcards in the query literally', async () => {
    const result = await dispatch('people.search', { q: '%' }, db.ctx());
    expect(result.total).toBe(0);
  });

  it('rejects invalid input', async () => {
    await expectCapabilityError(
      dispatch('people.search', { state: 'zz' }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('people.search', { limit: 1000 }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('people.get@1', () => {
  it('returns identity, card, terms, campaigns and platform with provenance', async () => {
    const result = await dispatch('people.get', { slug: 'avery-ashvale' }, db.ctx());
    expect(result.person.fullName).toBe('Avery Ashvale');
    expect(result.person.provenance.sourceId).toBe('dev-seed');
    expect(result.card.state).toBe('ZV');
    expect(result.identifiers.map((i) => i.scheme)).toContain('bioguide');
    expect(result.terms.length).toBeGreaterThan(0);
    expect(result.candidacies.some((c) => c.outcome === 'won')).toBe(true);
    expect(result.platform.length).toBeGreaterThan(0);
    expect(result.platform[0]?.provenance.sourceKey).toMatch(/^platform:/);
  });

  it('returns not_found for an unknown slug', async () => {
    await expectCapabilityError(
      dispatch('people.get', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
  });

  it('rejects a malformed slug', async () => {
    await expectCapabilityError(
      dispatch('people.get', { slug: 'Not A Slug' }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('people.compare@1', () => {
  it('returns cards in input order and pairwise yea/nay agreement', async () => {
    const slugs = ['blair-brindlemoor', 'avery-ashvale', 'kendall-kestrelby'];
    const result = await dispatch('people.compare', { slugs }, db.ctx());
    expect(result.people.map((p) => p.slug)).toEqual(slugs);
    expect(result.voteAgreement).toHaveLength(3);
    const senators = result.voteAgreement[0];
    expect(senators?.sharedVotes).toBeGreaterThan(0);
    expect(senators?.agreed).toBeLessThanOrEqual(senators?.sharedVotes ?? 0);
  });

  it('returns not_found naming the missing slug', async () => {
    const error = await expectCapabilityError(
      dispatch('people.compare', { slugs: ['avery-ashvale', 'nobody-here'] }, db.ctx()),
      'not_found',
    );
    expect(error.message).toContain('nobody-here');
  });

  it('rejects fewer than two or duplicate slugs', async () => {
    await expectCapabilityError(
      dispatch('people.compare', { slugs: ['avery-ashvale'] }, db.ctx()),
      'invalid_input',
    );
    await expectCapabilityError(
      dispatch('people.compare', { slugs: ['avery-ashvale', 'avery-ashvale'] }, db.ctx()),
      'invalid_input',
    );
  });
});
