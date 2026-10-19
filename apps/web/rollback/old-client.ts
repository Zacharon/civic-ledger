/** Runs with the baseline checkout's tsx and imports that exact checkout's schemas. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const baselineRoot = process.argv[2];
if (!baselineRoot) throw new Error('Missing baseline checkout');
const baseline = await import(pathToFileURL(join(baselineRoot, 'packages/core/src/index.ts')).href);
const records = JSON.parse(readFileSync(0, 'utf8')) as Array<{ name: string; payload: unknown }>;
for (const record of records) {
  const capability = baseline
    .publicCapabilities()
    .find((entry: { name: string }) => entry.name === record.name);
  if (!capability) throw new Error('Unknown baseline capability');
  capability.output.parse(record.payload);
}
process.stdout.write(JSON.stringify({ validated: records.length }));
