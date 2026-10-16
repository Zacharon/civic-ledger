import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  CURATED_FILE_SCHEMAS,
  type CuratedFrameworkFile,
  type CuratedIndustryMapFile,
  type CuratedKind,
  type CuratedPlatformsFile,
  type CuratedPolicyAreasFile,
  type CuratedPromisesFile,
  validateCuratedFile,
} from '@civic-ledger/core';
import { parse as parseYaml } from 'yaml';
import type { RawSnapshot } from '../../adapter';

export type CuratedRecord =
  | { kind: 'policy_areas'; file: string; data: CuratedPolicyAreasFile }
  | { kind: 'industry_map'; file: string; data: CuratedIndustryMapFile }
  | { kind: 'frameworks'; file: string; data: CuratedFrameworkFile }
  | { kind: 'promises'; file: string; data: CuratedPromisesFile }
  | { kind: 'platforms'; file: string; data: CuratedPlatformsFile };

/** Load order: vocabularies before the rows that reference them. */
const LOAD_ORDER: readonly CuratedKind[] = [
  'policy_areas',
  'industry_map',
  'frameworks',
  'promises',
  'platforms',
];

/** Every `<kind>/<name>.yaml` under the curated root, as forward-slash relative paths. */
export async function listCuratedFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => relative(root, join(e.parentPath, e.name)).replaceAll('\\', '/'))
    .sort();
}

/**
 * Validates every file with core's curated schemas (the same ones `pnpm curate:validate`
 * uses) and fails the run with file:line messages on any issue: half-valid curated data
 * is never loaded.
 */
export async function* parseCurated(snapshot: RawSnapshot): AsyncGenerator<CuratedRecord> {
  const parsed: CuratedRecord[] = [];
  const problems: string[] = [];
  for (const { fileName } of snapshot.files) {
    const content = await readFile(join(snapshot.directory, fileName), 'utf8');
    const result = validateCuratedFile({ path: `data/curated/${fileName}`, content });
    if (result.issues.length > 0 || !result.kind) {
      for (const issue of result.issues) {
        problems.push(
          `${fileName}${issue.line ? `:${issue.line}` : ''}: ${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
        );
      }
      continue;
    }
    parsed.push(toRecord(result.kind, fileName, parseYaml(content)));
  }
  if (problems.length > 0) throw new Error(`Curated data is invalid:\n${problems.join('\n')}`);
  for (const kind of LOAD_ORDER) yield* parsed.filter((r) => r.kind === kind);
}

function toRecord(kind: CuratedKind, file: string, raw: unknown): CuratedRecord {
  switch (kind) {
    case 'policy_areas':
      return { kind, file, data: CURATED_FILE_SCHEMAS.policy_areas.parse(raw) };
    case 'industry_map':
      return { kind, file, data: CURATED_FILE_SCHEMAS.industry_map.parse(raw) };
    case 'frameworks':
      return { kind, file, data: CURATED_FILE_SCHEMAS.frameworks.parse(raw) };
    case 'promises':
      return { kind, file, data: CURATED_FILE_SCHEMAS.promises.parse(raw) };
    case 'platforms':
      return { kind, file, data: CURATED_FILE_SCHEMAS.platforms.parse(raw) };
  }
}
