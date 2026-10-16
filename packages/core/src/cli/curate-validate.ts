import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validateCuratedFile } from '../curated/validate';

/** `pnpm curate:validate [dir]`: validates every YAML file under data/curated. */
const root = process.argv[2] ?? join('data', 'curated');

const entries = await readdir(root, { recursive: true, withFileTypes: true });
const paths = entries
  .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
  .map((e) => join(e.parentPath, e.name))
  .sort();

let failed = 0;
for (const path of paths) {
  const result = validateCuratedFile({ path, content: await readFile(path, 'utf8') });
  for (const issue of result.issues) {
    const where = issue.line === null ? '' : `:${issue.line}`;
    const field = issue.path ? ` ${issue.path}:` : '';
    console.error(`${relative(process.cwd(), path)}${where}:${field} ${issue.message}`);
  }
  if (result.issues.length > 0) failed++;
}

console.log(`${paths.length} curated file(s) checked, ${failed} with errors.`);
process.exitCode = failed > 0 ? 1 : 0;
