import { checkWebDbConfig } from './db-config';

/** Exits the process with one JSON log line when the database configuration is unsafe. */
export function refuseUnsafeDbConfig(): void {
  const problem = checkWebDbConfig(process.env);
  if (problem === null) return;
  const line = { level: 'fatal', msg: 'refusing to start: database configuration', err: problem };
  process.stderr.write(`${JSON.stringify(line)}\n`);
  process.exit(1);
}
