import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type AuditException,
  auditIgnores,
  exceptionProblems,
  productionPackages,
} from './exceptions';

/**
 * CI check for accepted audit advisories (`pnpm exec tsx scripts/audit/cli.ts`, audit job).
 * Network: the GitHub advisory API (GITHUB_TOKEN when set) and the npm registry. Any lookup
 * failure fails the check: an acceptance that cannot be re-verified is not kept silently.
 */
const root = join(import.meta.dirname, '..', '..');
const run = promisify(execFile);

async function json(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json', ...headers } });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return response.json();
}

async function main(): Promise<void> {
  const exceptions = JSON.parse(
    await readFile(join(root, 'scripts', 'audit', 'exceptions.json'), 'utf8'),
  ) as AuditException[];
  const ignores = auditIgnores(
    await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'),
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const token = process.env.GITHUB_TOKEN;
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};

  const patched = new Map<string, string[]>();
  const published = new Map<string, string[]>();
  for (const e of exceptions) {
    const advisory = (await json(`https://api.github.com/advisories/${e.ghsa}`, auth)) as {
      vulnerabilities?: Array<{
        package?: { name?: string };
        first_patched_version?: string | null;
      }>;
    };
    patched.set(
      e.ghsa,
      (advisory.vulnerabilities ?? [])
        .filter((v) => v.package?.name === e.package && v.first_patched_version)
        .map((v) => String(v.first_patched_version)),
    );
    const registry = (await json(
      `https://registry.npmjs.org/${encodeURIComponent(e.package)}`,
    )) as { versions?: Record<string, unknown> };
    published.set(e.package, Object.keys(registry.versions ?? {}));
  }

  const { stdout } = await run('pnpm', ['ls', '-r', '--prod', '--depth', 'Infinity', '--json'], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const production = productionPackages(JSON.parse(stdout));

  const problems = exceptionProblems(exceptions, {
    ignored: ignores.ghsas,
    ignoredCves: ignores.cves,
    patched,
    published,
    production,
    today: new Date().toISOString().slice(0, 10),
  });
  for (const e of exceptions) {
    console.log(
      `${e.ghsa} ${e.package} ${e.vulnerable}: accepted until ${e.expires} (${e.decision})`,
    );
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`audit exception: ${p}`);
    process.exit(1);
  }
  console.log(`audit exceptions: ${exceptions.length} checked, all still hold`);
}

main().catch((error: unknown) => {
  console.error(
    `audit exceptions: could not verify (${error instanceof Error ? error.message : String(error)})`,
  );
  process.exit(1);
});
