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
  /** GHSA ids listed in `auditConfig.ignoreGhsas`. */
  ignored: string[];
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

/** The GHSA ids under `auditConfig.ignoreGhsas` in a pnpm-workspace.yaml text. */
export function ignoredGhsas(workspaceYaml: string): string[] {
  const lines = workspaceYaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s+ignoreGhsas:\s*$/.test(l));
  if (start < 0) return [];
  const indent = (lines[start]?.match(/^\s*/)?.[0].length ?? 0) + 1;
  const ids: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if ((line.match(/^\s*/)?.[0].length ?? 0) < indent) break;
    const m = /^\s*-\s*['"]?(GHSA-[0-9a-z-]+)['"]?\s*(#.*)?$/i.exec(line);
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

/** Every reason the accepted advisories are no longer acceptable; empty when all hold. */
export function exceptionProblems(exceptions: AuditException[], facts: ExceptionFacts): string[] {
  const problems: string[] = [];
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
    if (!DATE.test(e.reviewed) || !DATE.test(e.expires)) {
      problems.push(`${where}: reviewed and expires must be YYYY-MM-DD`);
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

interface LsNode {
  dependencies?: Record<string, LsNode>;
}

/** Package names anywhere in `pnpm ls -r --prod --depth Infinity --json` output. */
export function productionPackages(ls: Array<LsNode>): Set<string> {
  const names = new Set<string>();
  const walk = (deps: Record<string, LsNode> | undefined) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      if (names.has(name) && !node.dependencies) continue;
      names.add(name);
      walk(node.dependencies);
    }
  };
  for (const project of ls) walk(project.dependencies);
  return names;
}
