import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';

/**
 * FEC bulk `.txt` rows: pipe-delimited, no header row, latin-1, no quoting (names may
 * contain bare `"`). Yields one string array per line.
 */
export async function* fecPipeRows(
  input: Readable,
  expectedColumns: number,
): AsyncGenerator<string[]> {
  input.setEncoding('latin1');
  const parser = input.pipe(
    parse({ delimiter: '|', quote: false, relax_column_count: true, skip_empty_lines: true }),
  );
  let line = 0;
  for await (const record of parser as AsyncIterable<string[]>) {
    line++;
    if (record.length !== expectedColumns) {
      throw new Error(`Line ${line}: expected ${expectedColumns} columns, got ${record.length}`);
    }
    yield record;
  }
}

/** Header CSV (Voteview, FEC IE file): yields one object per row keyed by the header. */
export async function* headerCsvRows(
  input: Readable,
  requiredColumns: readonly string[],
  encoding: BufferEncoding = 'utf8',
): AsyncGenerator<Record<string, string>> {
  input.setEncoding(encoding);
  const parser = input.pipe(
    parse({ columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()), bom: true }),
  );
  let checked = false;
  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    if (!checked) {
      const missing = requiredColumns.filter((c) => !(c in record));
      if (missing.length > 0) throw new Error(`Missing CSV column(s): ${missing.join(', ')}`);
      checked = true;
    }
    yield record;
  }
}

/** Maps a positional row to named fields using a fixed column list. */
export function named<const C extends readonly string[]>(
  columns: C,
  row: string[],
): Record<C[number], string> {
  const out: Record<string, string> = {};
  columns.forEach((column, i) => {
    out[column] = row[i] ?? '';
  });
  return out as Record<C[number], string>;
}
