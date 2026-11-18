import { parse as parseYaml } from 'yaml';

/**
 * Accepted audit advisories (DECISIONS A48, A97). `pnpm-workspace.yaml` `auditConfig.ignoreGhsas`
 * hides an advisory from both `pnpm audit` steps; this check keeps every such ignore honest. It
 * fails when an ignore has no record here (or a record no ignore), when a record is past its
 * expiry (UTC) or was given more than 30 days, when the advisory now names a patched version or
 * the registry publishes a release outside the vulnerable range (upgrade instead), and when the
 * package appears in the production dependency graph (a dev-only acceptance no longer holds).
 * Pure: the CLI (`cli.ts`) gathers the facts.
 */

export const MAX_EXCEPTION_DAYS = 30;

export interface AuditException {
  ghsa: string;
  package: string;
  /** The advisory's vulnerable range, `<=x.y.z` or `<x.y.z`. */
  vulnerable: string;
  /** YYYY-MM-DD (UTC) the acceptance was last reviewed. */
  reviewed: string;
  /** YYYY-MM-DD (UTC); the check fails on the day after. At most 30 days after `reviewed`. */
  expires: string;
  decision: string;
}

export interface ExceptionFacts {
  /** GHSA ids pnpm ignores (`auditIgnores`). */
  ignored: string[];
  /** CVE ids pnpm ignores; none may exist, since exceptions are recorded by GHSA. */
  ignoredCves?: string[];
  /** GHSA id -> the advisory's first patched versions for the package (empty: none). */
  patched: Map<string, string[]>;
  /** Package -> every version the registry publishes. */
  published: Map<string, string[]>;
  /** Every package name in `pnpm ls -r --prod --depth Infinity`. */
  production: Set<string>;
  /** Today, YYYY-MM-DD in UTC. */
  today: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** True when `version` (a plain release, x.y.z) is inside `range` (`<=x.y.z` or `<x.y.z`). */
export function inVulnerableRange(version: string, range: string): boolean {
  const m = /^(<=?)\s*(\d+\.\d+\.\d+)$/.exec(range.trim());
  const v = parseVersion(version);
  const bound = m?.[2] ? parseVersion(m[2]) : null;
  if (!m || !v || !bound) throw new Error(`Unsupported range or version: ${range} / ${version}`);
  const c = compare(v, bound);
  return m[1] === '<=' ? c <= 0 : c < 0;
}

/** Advisory ignores pnpm applies to `pnpm audit`, from every place it reads them. */
export interface AuditIgnores {
  ghsas: string[];
  cves: string[];
}

function stringList(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${where} must be a list of strings`);
  }
  return value as string[];
}

/**
 * The ignores in `auditConfig` of a pnpm-workspace.yaml text (any YAML form: block or inline
 * list, quoted or not) and, when given, the legacy `pnpm.auditConfig` of the root package.json.
 * Parsed with a real YAML parser; a malformed file throws instead of reading as "no ignores".
 */
export function auditIgnores(workspaceYaml: string, packageJson?: string): AuditIgnores {
  const workspace = (parseYaml(workspaceYaml) ?? {}) as { auditConfig?: Record<string, unknown> };
  const legacy = packageJson
    ? ((JSON.parse(packageJson) as { pnpm?: { auditConfig?: Record<string, unknown> } }).pnpm
        ?.auditConfig ?? {})
    : {};
  const config = workspace.auditConfig ?? {};
  return {
    ghsas: [
      ...stringList(config.ignoreGhsas, 'pnpm-workspace.yaml auditConfig.ignoreGhsas'),
      ...stringList(legacy.ignoreGhsas, 'package.json pnpm.auditConfig.ignoreGhsas'),
    ],
    cves: [
      ...stringList(config.ignoreCves, 'pnpm-workspace.yaml auditConfig.ignoreCves'),
      ...stringList(legacy.ignoreCves, 'package.json pnpm.auditConfig.ignoreCves'),
    ],
  };
}

/** A real calendar date in YYYY-MM-DD form (2026-99-99 and 2026-02-30 are not). */
export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/** Every reason the accepted advisories are no longer acceptable; empty when all hold. */
export function exceptionProblems(exceptions: AuditException[], facts: ExceptionFacts): string[] {
  const problems: string[] = [];
  if (!isCalendarDate(facts.today)) problems.push(`today (${facts.today}) is not a calendar date`);
  for (const id of facts.ignoredCves ?? []) {
    problems.push(`${id} is ignored by CVE; record and ignore advisories by GHSA id only`);
  }
  const recorded = new Set(exceptions.map((e) => e.ghsa));
  for (const id of facts.ignored) {
    if (!recorded.has(id))
      problems.push(
        `${id} is ignored in pnpm-workspace.yaml but has no record in scripts/audit/exceptions.json`,
      );
  }
  for (const e of exceptions) {
    const where = `${e.ghsa} (${e.package}, ${e.decision})`;
    if (!facts.ignored.includes(e.ghsa))
      problems.push(`${where} is recorded but not ignored; remove the record`);
    if (!isCalendarDate(e.reviewed) || !isCalendarDate(e.expires)) {
      problems.push(`${where}: reviewed and expires must be real YYYY-MM-DD dates`);
      continue;
    }
    if (days(e.reviewed, e.expires) > MAX_EXCEPTION_DAYS) {
      problems.push(
        `${where}: expires ${e.expires} is more than ${MAX_EXCEPTION_DAYS} days after its review ${e.reviewed}`,
      );
    }
    if (facts.today > e.expires) {
      problems.push(
        `${where}: the acceptance expired on ${e.expires} (UTC); re-review it and set a new date, or upgrade`,
      );
    }
    const patched = facts.patched.get(e.ghsa) ?? [];
    if (patched.length > 0) {
      problems.push(
        `${where}: the advisory now lists a patched version (${patched.join(', ')}); upgrade and remove the ignore`,
      );
    }
    const outside = (facts.published.get(e.package) ?? []).filter(
      (v) => parseVersion(v) !== null && !inVulnerableRange(v, e.vulnerable),
    );
    if (outside.length > 0) {
      problems.push(
        `${where}: ${e.package} ${outside.join(', ')} is outside ${e.vulnerable}; recheck the advisory and upgrade`,
      );
    }
    if (facts.production.has(e.package)) {
      problems.push(
        `${where}: ${e.package} is in the production dependency graph; the dev-only acceptance no longer holds`,
      );
    }
  }
  return problems;
}

/** One node of `pnpm list --json` output (pnpm 11): a project or an installed package. */
export interface LsNode {
  /** The real package name; differs from the key for an alias (`"alias": "npm:real@x"`). */
  from?: string;
  version?: string;
  dependencies?: Record<string, LsNode>;
  optionalDependencies?: Record<string, LsNode>;
}

/** Real package name of an entry keyed `key`: `from` when present (aliases), else the key. */
function realName(key: string, node: LsNode): string {
  const from = node.from?.replace(/^npm:/, '') ?? key;
  // `from` can carry a version for an alias spec (`real@1.2.3`, `@scope/real@1.2.3`).
  const at = from.lastIndexOf('@');
  return at > 0 ? from.slice(0, at) : from;
}

/**
 * Real package names anywhere in `pnpm list -r --prod --depth Infinity --json` output,
 * following `dependencies` and `optionalDependencies` (pnpm lists a direct optional
 * dependency under the latter) at every depth, and resolving aliases to their real name.
 * The alias key is recorded too (conservative: an alias named like a vulnerable package is
 * flagged rather than missed).
 */
export function productionPackages(ls: LsNode[]): Set<string> {
  const names = new Set<string>();
  const seen = new Set<LsNode>();
  const visit = (key: string, node: LsNode) => {
    names.add(realName(key, node));
    names.add(key);
    if (seen.has(node)) return;
    seen.add(node);
    children(node);
  };
  const children = (node: LsNode) => {
    for (const group of [node.dependencies, node.optionalDependencies]) {
      for (const [key, child] of Object.entries(group ?? {})) visit(key, child);
    }
  };
  for (const project of ls) children(project);
  return names;
}
