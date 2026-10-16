import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURATED_KINDS } from '../src/curated/schemas';
import { curatedKindForPath, validateCuratedFile } from '../src/curated/validate';
import { dispatch } from '../src/dispatch';
import { expectCapabilityError } from './helpers';

const readmeExample = (kind: string): string => {
  const readme = readFileSync(
    new URL(`../../../data/curated/${kind}/README.md`, import.meta.url),
    'utf8',
  );
  const example = /```yaml\n([\s\S]*?)```/.exec(readme)?.[1];
  if (!example) throw new Error(`No yaml example in ${kind}/README.md`);
  return example;
};

// curated.validate is pure, so no database is needed.
const noDb = {
  get db(): never {
    throw new Error('curated.validate must not touch the database');
  },
};

describe('curated file validation', () => {
  it.each(CURATED_KINDS)('accepts the documented %s example', (kind) => {
    const result = validateCuratedFile({
      path: `data/curated/${kind}/example.yaml`,
      content: readmeExample(kind),
    });
    expect(result).toEqual({ path: `data/curated/${kind}/example.yaml`, kind, issues: [] });
  });

  it('maps a file to its kind by folder, on any OS path style', () => {
    expect(curatedKindForPath('data\\curated\\frameworks\\x.yml')).toBe('frameworks');
    expect(curatedKindForPath('data/curated/notes/x.yaml')).toBeNull();
    expect(curatedKindForPath('data/curated/promises/x.json')).toBeNull();
  });

  it('reports schema errors with the YAML line and field path', () => {
    const content = readmeExample('promises').replace('status: in_progress', 'status: fulfilled');
    const { issues } = validateCuratedFile({ path: 'data/curated/promises/x.yaml', content });
    const line = content.split('\n').findIndex((l) => l.includes('status: fulfilled')) + 1;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line, path: 'promises.0.ratings.0.status' });
  });

  it('reports a missing required key on its parent line', () => {
    const content = readmeExample('platforms').replace(/ {4}source_url: .*\n/, '');
    const { issues } = validateCuratedFile({ path: 'data/curated/platforms/x.yaml', content });
    const parentLine = content.split('\n').findIndex((l) => l.includes('- policy_area')) + 1;
    expect(issues[0]).toMatchObject({ path: 'positions.0.source_url', line: parentLine });
  });

  it('reports YAML syntax errors and duplicate ids', () => {
    const broken = validateCuratedFile({
      path: 'data/curated/frameworks/x.yaml',
      content: 'slug: [unclosed\n',
    });
    expect(broken.issues[0]?.line).toBeGreaterThan(0);
    const dup = readmeExample('industry_map').replace(
      'committees:',
      'committees:\n  - fec_committee_id: C99000001\n    industry: example-industry\n    method: curated\n    confidence: 1',
    );
    const { issues } = validateCuratedFile({
      path: 'data/curated/industry_map/x.yaml',
      content: dup,
    });
    expect(issues.map((i) => i.message)).toContain('Duplicate fec_committee_id "C99000001"');
  });

  it('rejects files outside a known curated folder', () => {
    const result = validateCuratedFile({
      path: 'data/curated/x.yaml',
      content: 'schema_version: 1\n',
    });
    expect(result.kind).toBeNull();
    expect(result.issues).toHaveLength(1);
  });
});

describe('curated.validate@1', () => {
  it('validates a batch through the registry without touching the database', async () => {
    const result = await dispatch(
      'curated.validate',
      {
        files: [
          { path: 'data/curated/platforms/a.yaml', content: readmeExample('platforms') },
          { path: 'data/curated/platforms/b.yaml', content: 'schema_version: 2\n' },
        ],
      },
      noDb,
    );
    expect(result.valid).toBe(false);
    expect(result.files.map((f) => f.issues.length > 0)).toEqual([false, true]);
  });

  it('rejects an empty batch', async () => {
    await expectCapabilityError(dispatch('curated.validate', { files: [] }, noDb), 'invalid_input');
  });
});
