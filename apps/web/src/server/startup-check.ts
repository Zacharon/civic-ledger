import { checkWebDbConfig } from './db-config';
import { startupReadOnlyProblem, webReadOnlyGate } from './readonly-gate';

function refuse(problem: string): void {
  const line = { level: 'fatal', msg: 'refusing to start: database configuration', err: problem };
  process.stderr.write(`${JSON.stringify(line)}\n`);
  process.exit(1);
}

/**
 * Exits the process with one JSON log line when the database configuration is unsafe: no
 * read-only URL in production (A61), or a "read-only" login that can write (attested against
 * the database). An unreachable database does not stop startup; the first read re-checks.
 */
export async function refuseUnsafeDbConfig(): Promise<void> {
  const problem = checkWebDbConfig(process.env);
  if (problem !== null) return refuse(problem);
  const attested = await startupReadOnlyProblem(webReadOnlyGate());
  if (attested !== null) refuse(attested);
}
