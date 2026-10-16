import { type Document, isNode, LineCounter, parseDocument } from 'yaml';
import { CURATED_FILE_SCHEMAS, CURATED_KINDS, type CuratedKind } from './schemas';

export interface CuratedFile {
  path: string;
  content: string;
}

export interface CuratedIssue {
  line: number | null;
  path: string;
  message: string;
}

export interface CuratedFileResult {
  path: string;
  kind: CuratedKind | null;
  issues: CuratedIssue[];
}

const isCuratedKind = (value: string | undefined): value is CuratedKind =>
  CURATED_KINDS.some((kind) => kind === value);

/** `.../<kind>/<file>.yaml` → kind, where kind is one of CURATED_KINDS. */
export function curatedKindForPath(path: string): CuratedKind | null {
  const segments = path.replaceAll('\\', '/').split('/');
  const file = segments.at(-1) ?? '';
  const folder = segments.at(-2);
  return /\.ya?ml$/.test(file) && isCuratedKind(folder) ? folder : null;
}

/** Validates one curated YAML file with the same zod schemas the loader uses. */
export function validateCuratedFile(file: CuratedFile): CuratedFileResult {
  const kind = curatedKindForPath(file.path);
  if (!kind) {
    const message = `Curated files must be data/curated/<${CURATED_KINDS.join('|')}>/<name>.yaml`;
    return { path: file.path, kind, issues: [{ line: null, path: '', message }] };
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(file.content, { lineCounter });
  if (doc.errors.length > 0) {
    const issues = doc.errors.map((e) => ({
      line: e.linePos?.[0].line ?? null,
      path: '',
      message: e.message,
    }));
    return { path: file.path, kind, issues };
  }

  const parsed = CURATED_FILE_SCHEMAS[kind].safeParse(doc.toJS());
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const path = issue.path.filter((p) => typeof p !== 'symbol');
        return {
          line: lineOf(doc, path, lineCounter),
          path: path.join('.'),
          message: issue.message,
        };
      });
  return { path: file.path, kind, issues };
}

/** Line of the deepest existing YAML node on `path` (missing keys report their parent). */
function lineOf(doc: Document, path: (string | number)[], lineCounter: LineCounter): number | null {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
    if (isNode(node) && node.range) return lineCounter.linePos(node.range[0]).line;
  }
  return null;
}
