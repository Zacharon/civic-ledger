import { formatDate, safeHref } from '@/lib/format';

export interface Provenance {
  sourceId: string;
  sourceKey: string;
  ingestRunId: number;
  retrievedAt: string;
}

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
}

interface Note {
  n: number;
  source: SourceInfo;
  keys: string[];
  runIds: Set<number>;
  retrievedAt: string;
}

/**
 * Per-section footnotes: each distinct source gets a number; numbers in the section
 * carry a mark linking to the section's Sources list (DESIGN.md signature element).
 */
export class SourceNotes {
  private readonly notes = new Map<string, Note>();

  constructor(
    readonly sectionId: string,
    private readonly sources: readonly SourceInfo[],
  ) {}

  cite(provenance: Provenance | null | undefined): number | null {
    if (!provenance) return null;
    let note = this.notes.get(provenance.sourceId);
    if (!note) {
      const source = this.sources.find((s) => s.id === provenance.sourceId) ?? {
        id: provenance.sourceId,
        name: provenance.sourceId,
        url: '',
      };
      note = {
        n: this.notes.size + 1,
        source,
        keys: [],
        runIds: new Set(),
        retrievedAt: provenance.retrievedAt,
      };
      this.notes.set(provenance.sourceId, note);
    }
    if (!note.keys.includes(provenance.sourceKey)) note.keys.push(provenance.sourceKey);
    note.runIds.add(provenance.ingestRunId);
    if (provenance.retrievedAt > note.retrievedAt) note.retrievedAt = provenance.retrievedAt;
    return note.n;
  }

  citeAll(provenances: readonly (Provenance | null | undefined)[]): number[] {
    return [...new Set(provenances.map((p) => this.cite(p)).filter((n) => n !== null))];
  }

  list(): Note[] {
    return [...this.notes.values()];
  }
}

export function SourceMark({ notes, n }: { notes: SourceNotes; n: number | null | number[] }) {
  const numbers = (Array.isArray(n) ? n : [n]).filter((x): x is number => x !== null);
  if (numbers.length === 0) return null;
  return (
    <sup className="ml-0.5 text-[0.7em] font-semibold leading-none">
      {numbers.map((x, i) => (
        <span key={x}>
          {i > 0 ? ',' : null}
          <a
            href={`#${notes.sectionId}-source-${x}`}
            className="text-accent no-underline hover:underline"
            aria-label={`Source ${x}`}
          >
            {x}
          </a>
        </span>
      ))}
    </sup>
  );
}

const MAX_KEYS = 3;

export function SourceList({ notes, title = 'Sources' }: { notes: SourceNotes; title?: string }) {
  const items = notes.list();
  if (items.length === 0) return null;
  return (
    <div className="mt-8 border-t border-rule pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h3>
      <ol className="mt-2 space-y-1.5 text-sm text-ink-2">
        {items.map((note) => {
          const href = safeHref(note.source.url);
          const shown = note.keys.slice(0, MAX_KEYS);
          const more = note.keys.length - shown.length;
          return (
            <li key={note.n} id={`${notes.sectionId}-source-${note.n}`} className="flex gap-2">
              <span className="num w-4 shrink-0 text-right font-semibold text-ink">{note.n}</span>
              <span className="min-w-0">
                {href ? (
                  <a className="link" href={href} rel="noreferrer">
                    {note.source.name}
                  </a>
                ) : (
                  note.source.name
                )}
                {'. '}
                <span className="break-words">
                  {note.keys.length === 1 ? 'Record ' : 'Records '}
                  <span className="num">{shown.join(', ')}</span>
                  {more > 0 ? ` and ${more} more` : ''}
                </span>
                {'. Retrieved '}
                {formatDate(note.retrievedAt)}, ingest run{' '}
                <span className="num">{[...note.runIds].sort((a, b) => a - b).join(', ')}</span>.{' '}
                <a className="link" href={`/sources#source-${note.source.id}`}>
                  About this source
                </a>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
