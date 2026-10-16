import { CapabilityError, publicCapabilities } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coerceQuery } from '../src/server/api/query';

function schemaOf(name: string): z.core.JSONSchema.JSONSchema {
  const capability = publicCapabilities().find((c) => c.name === name);
  if (!capability) throw new Error(`no capability ${name}`);
  return z.toJSONSchema(capability.input, { io: 'input', unrepresentable: 'any' });
}

const coerce = (name: string, query: string) =>
  coerceQuery(schemaOf(name), new URLSearchParams(query));

describe('coerceQuery', () => {
  it('coerces integers by declared type and leaves strings alone', () => {
    expect(coerce('people.search', 'q=12&limit=5&offset=0&state=ZY')).toEqual({
      q: '12',
      limit: 5,
      offset: 0,
      state: 'ZY',
    });
  });

  it('keeps a wrongly shaped value as a string so validation reports it', () => {
    expect(coerce('people.search', 'limit=abc&offset=1.5')).toEqual({ limit: 'abc', offset: 1.5 });
  });

  it('builds nested objects from dotted and bracket keys', () => {
    const expected = { filters: { chamber: 'house', q: 'a' } };
    expect(coerce('explore.table', 'filters.chamber=house&filters.q=a')).toEqual(expected);
    expect(coerce('explore.table', 'filters[chamber]=house&filters[q]=a')).toEqual(expected);
  });

  it('builds arrays of objects from indexed keys', () => {
    expect(
      coerce('explore.table', 'sort.0.column=state&sort.1.column=sortName&sort.1.direction=desc'),
    ).toEqual({
      sort: [{ column: 'state' }, { column: 'sortName', direction: 'desc' }],
    });
  });

  it('builds arrays of scalars from repeated and comma-separated keys', () => {
    expect(coerce('people.compare', 'slugs=a-b&slugs=c-d')).toEqual({ slugs: ['a-b', 'c-d'] });
    expect(coerce('people.compare', 'slugs=a-b,c-d')).toEqual({ slugs: ['a-b', 'c-d'] });
  });

  it('accepts the whole input as JSON', () => {
    const input = JSON.stringify({ sort: [{ column: 'state' }] });
    expect(coerce('explore.table', new URLSearchParams({ input }).toString())).toEqual({
      sort: [{ column: 'state' }],
    });
  });

  it('keeps unknown keys so strict validation can reject them', () => {
    expect(coerce('people.search', 'bogus=1&filters.x=2')).toEqual({
      bogus: '1',
      filters: { x: '2' },
    });
  });

  it.each([
    ['limit=1&limit=2', 'Parameter given more than once'],
    ['input={}&limit=1', '"input" cannot be combined with other query parameters'],
    ['input=%7Bnope', '"input" must be valid JSON'],
    ['__proto__.polluted=1', 'Invalid parameter name "__proto__.polluted"'],
    ['sort.100000.column=state', 'Array index must be at most 1000'],
    ['sort=state', 'Use indexed keys'],
    ['=x', 'Invalid parameter name'],
  ])('rejects %s', (query, message) => {
    let error: unknown;
    try {
      coerce('explore.table', query);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CapabilityError);
    const failure = error as CapabilityError;
    expect(failure.code).toBe('invalid_input');
    expect(failure.issues?.[0]?.message).toContain(message);
  });

  it('never pollutes Object.prototype', () => {
    expect(() => coerce('people.search', '__proto__.polluted=1')).toThrow(CapabilityError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles every public capability schema without throwing on empty input', () => {
    for (const capability of publicCapabilities()) {
      expect(() => coerce(capability.name, '')).not.toThrow();
    }
  });
});
