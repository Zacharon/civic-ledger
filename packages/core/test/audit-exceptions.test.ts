import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  type AuditException,
  auditIgnores,
  type ExceptionFacts,
  exceptionProblems,
  inVulnerableRange,
  isCalendarDate,
  type LsNode,
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
    const pkg = await readFile(new URL('../../../package.json', import.meta.url), 'utf8');
    expect(auditIgnores(yaml, pkg)).toEqual({ ghsas: records.map((r) => r.ghsa), cves: [] });
    // The committed records themselves are valid apart from the date (checked against today in CI).
    expect(exceptionProblems(records, holding({ today: records[0]?.reviewed ?? '' }))).toEqual([]);
  });

  it('reads ignores in every YAML form, so an inline list cannot hide an unrecorded ignore', () => {
    const block = 'auditConfig:\n  ignoreGhsas:\n    # why\n    - GHSA-fc5q-39xc-vjpf\n';
    const inline = 'packages:\n  - apps/*\nauditConfig:\n  ignoreGhsas: [GHSA-fc5q-39xc-vjpf]\n';
    const quoted =
      "auditConfig: { ignoreGhsas: ['GHSA-fc5q-39xc-vjpf'], ignoreCves: [CVE-2026-1] }";
    expect(auditIgnores(block).ghsas).toEqual(['GHSA-fc5q-39xc-vjpf']);
    expect(auditIgnores(inline).ghsas).toEqual(['GHSA-fc5q-39xc-vjpf']);
    expect(auditIgnores(quoted)).toEqual({ ghsas: ['GHSA-fc5q-39xc-vjpf'], cves: ['CVE-2026-1'] });
    expect(auditIgnores('packages: [apps/*]\n')).toEqual({ ghsas: [], cves: [] });
    // The legacy package.json location counts too.
    expect(
      auditIgnores('', JSON.stringify({ pnpm: { auditConfig: { ignoreGhsas: ['GHSA-x'] } } }))
        .ghsas,
    ).toEqual(['GHSA-x']);
    expect(() => auditIgnores('auditConfig:\n  ignoreGhsas: GHSA-fc5q-39xc-vjpf\n')).toThrow(
      /must be a list of strings/,
    );
    // The review's bypass: an inline ignore after expiry, with its record deleted, fails.
    expect(
      exceptionProblems([], holding({ ignored: auditIgnores(inline).ghsas, today: '2027-01-01' })),
    ).toEqual([expect.stringContaining('has no record in scripts/audit/exceptions.json')]);
  });

  it('rejects dates that are not on the calendar, and any CVE ignore', () => {
    expect(isCalendarDate('2026-12-17')).toBe(true);
    for (const bad of ['2026-99-99', '2026-02-30', '2026-13-01', '2026-1-01', '']) {
      expect(isCalendarDate(bad), bad).toBe(false);
    }
    expect(exceptionProblems([{ ...PICOMATCH, expires: '2026-99-99' }], holding())).toEqual([
      expect.stringContaining('must be real YYYY-MM-DD dates'),
    ]);
    expect(exceptionProblems([{ ...PICOMATCH, reviewed: '2026-02-30' }], holding())).toEqual([
      expect.stringContaining('must be real YYYY-MM-DD dates'),
    ]);
    expect(exceptionProblems([PICOMATCH], holding({ ignoredCves: ['CVE-2026-1'] }))).toEqual([
      expect.stringContaining('ignored by CVE'),
    ]);
  });

  // Real `pnpm list --prod --json --depth Infinity` output (pnpm 11.13.1) of three throwaway
  // projects, with local paths replaced by <fixture>.
  it.each([
    ['optional-direct.json', 'a direct optional dependency (listed under optionalDependencies)'],
    ['alias.json', 'an aliased dependency (listed under its alias with from: "picomatch")'],
    ['transitive.json', 'a transitive dependency (tinyglobby > picomatch, fdir > picomatch)'],
  ])('finds picomatch in %s: %s', async (file) => {
    const ls = JSON.parse(
      await readFile(new URL(`./fixtures/pnpm-list/${file}`, import.meta.url), 'utf8'),
    ) as LsNode[];
    const production = productionPackages(ls);
    expect(production.has('picomatch')).toBe(true);
    expect(exceptionProblems([PICOMATCH], holding({ production }))).toEqual([
      expect.stringContaining('production dependency graph'),
    ]);
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
