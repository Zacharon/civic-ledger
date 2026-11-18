import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  type AuditException,
  type ExceptionFacts,
  exceptionProblems,
  ignoredGhsas,
  inVulnerableRange,
  productionPackages,
} from '../../../scripts/audit/exceptions';

const PICOMATCH: AuditException = {
  ghsa: 'GHSA-fc5q-39xc-vjpf',
  package: 'picomatch',
  vulnerable: '<=4.0.7',
  reviewed: '2026-11-17',
  expires: '2026-12-17',
  decision: 'docs/DECISIONS.md A97',
};

const holding = (over: Partial<ExceptionFacts> = {}): ExceptionFacts => ({
  ignored: ['GHSA-fc5q-39xc-vjpf'],
  patched: new Map([['GHSA-fc5q-39xc-vjpf', []]]),
  published: new Map([['picomatch', ['2.3.1', '4.0.6', '4.0.7']]]),
  production: new Set(['hono', 'next']),
  today: '2026-11-17',
  ...over,
});

describe('audit exceptions (DECISIONS A97)', () => {
  it('passes while the advisory is unpatched, dev-only and unexpired', () => {
    expect(exceptionProblems([PICOMATCH], holding())).toEqual([]);
    expect(exceptionProblems([PICOMATCH], holding({ today: '2026-12-17' }))).toEqual([]);
  });

  it('fails the day after the expiry date (UTC)', () => {
    expect(exceptionProblems([PICOMATCH], holding({ today: '2026-12-18' }))).toEqual([
      expect.stringContaining('expired on 2026-12-17'),
    ]);
  });

  it('refuses an acceptance longer than 30 days', () => {
    const long = { ...PICOMATCH, expires: '2026-12-18' };
    expect(exceptionProblems([long], holding())).toEqual([
      expect.stringContaining('more than 30 days'),
    ]);
  });

  it('fails when the advisory gains a patched version or a release leaves the range', () => {
    expect(
      exceptionProblems(
        [PICOMATCH],
        holding({ patched: new Map([['GHSA-fc5q-39xc-vjpf', ['4.0.8']]]) }),
      ),
    ).toEqual([expect.stringContaining('patched version (4.0.8)')]);
    expect(
      exceptionProblems(
        [PICOMATCH],
        holding({ published: new Map([['picomatch', ['4.0.7', '4.0.8']]]) }),
      ),
    ).toEqual([expect.stringContaining('picomatch 4.0.8 is outside <=4.0.7')]);
  });

  it('fails when the package enters the production dependency graph', () => {
    expect(
      exceptionProblems([PICOMATCH], holding({ production: new Set(['next', 'picomatch']) })),
    ).toEqual([expect.stringContaining('production dependency graph')]);
  });

  it('keeps the ignore list and the records in step', () => {
    expect(exceptionProblems([], holding())).toEqual([
      expect.stringContaining('has no record in scripts/audit/exceptions.json'),
    ]);
    expect(exceptionProblems([PICOMATCH], holding({ ignored: [] }))).toEqual([
      expect.stringContaining('recorded but not ignored'),
    ]);
  });

  it('reads the repository files the CI check reads', async () => {
    const yaml = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8');
    const records = JSON.parse(
      await readFile(new URL('../../../scripts/audit/exceptions.json', import.meta.url), 'utf8'),
    ) as AuditException[];
    expect(ignoredGhsas(yaml)).toEqual(records.map((r) => r.ghsa));
    // The committed records themselves are valid apart from the date (checked against today in CI).
    expect(exceptionProblems(records, holding({ today: records[0]?.reviewed ?? '' }))).toEqual([]);
  });

  it('parses ranges and the pnpm ls tree', () => {
    expect(inVulnerableRange('4.0.7', '<=4.0.7')).toBe(true);
    expect(inVulnerableRange('4.0.8', '<=4.0.7')).toBe(false);
    expect(inVulnerableRange('4.0.7', '<4.0.7')).toBe(false);
    expect(inVulnerableRange('10.0.0', '<=4.0.7')).toBe(false);
    expect(
      productionPackages([
        { dependencies: { next: { dependencies: { picomatch: {} } } } },
        { dependencies: { hono: {} } },
      ]),
    ).toEqual(new Set(['next', 'picomatch', 'hono']));
  });
});
