import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { fecPipeRows, headerCsvRows } from '../src/parse/csv';
import { jsonArrayElements } from '../src/parse/json-array';
import {
  dateFromDdMonYy,
  dateFromMmddyyyy,
  dateFromSlashed,
  dollarsToCents,
  slugify,
} from '../src/parse/values';

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

/** A stream that delivers `text` in tiny chunks, to cross every token boundary. */
const chunkedStream = (text: string, size = 3) =>
  Readable.from(
    Array.from({ length: Math.ceil(text.length / size) }, (_, i) =>
      text.slice(i * size, (i + 1) * size),
    ),
  );

describe('value normalizers', () => {
  it('converts decimal dollar strings to exact integer cents', () => {
    expect(dollarsToCents('2329.55')).toBe(232955);
    expect(dollarsToCents('-2500')).toBe(-250000);
    expect(dollarsToCents('0.1')).toBe(10);
    expect(dollarsToCents('104019.3')).toBe(10401930);
    expect(dollarsToCents('9000000000')).toBe(900000000000);
    expect(dollarsToCents('')).toBeNull();
    expect(() => dollarsToCents('12a')).toThrow(/Not a dollar amount/);
  });

  it('parses the three FEC date formats into ISO dates', () => {
    expect(dateFromMmddyyyy('06232025')).toBe('2025-06-23');
    expect(dateFromSlashed('09/30/2026')).toBe('2026-09-30');
    expect(dateFromDdMonYy('16-MAY-26')).toBe('2026-05-16');
    expect(dateFromDdMonYy('24-nov-25')).toBe('2025-11-24');
    expect(dateFromDdMonYy('01-JAN-99')).toBe('1999-01-01');
    expect(dateFromMmddyyyy('')).toBeNull();
    expect(() => dateFromMmddyyyy('02302025')).toThrow(/calendar date/);
  });

  it('slugifies names to ASCII kebab-case', () => {
    expect(slugify('Nydia M. Velázquez N000147')).toBe('nydia-m-velazquez-n000147');
    expect(slugify('  Earl L. "Buddy" Carter ')).toBe('earl-l-buddy-carter');
  });
});

describe('streaming JSON array', () => {
  it('yields each element even when chunks split strings, escapes and nesting', async () => {
    const doc = '[\n {"a": "x]}\\"", "b": [1, {"c": "{"}]},\n {"a": "é"} ]\n';
    const items = await collect(jsonArrayElements(chunkedStream(doc, 2)));
    expect(items).toEqual([{ a: 'x]}"', b: [1, { c: '{' }] }, { a: 'é' }]);
  });

  it('rejects truncated or non-array documents', async () => {
    await expect(collect(jsonArrayElements(Readable.from(['[{"a":1}'])))).rejects.toThrow(
      /Truncated/,
    );
    await expect(collect(jsonArrayElements(Readable.from(['{"a":1}'])))).rejects.toThrow(
      /top-level/,
    );
  });
});

describe('CSV readers', () => {
  it('reads FEC pipe rows as latin-1 with bare quotes and checks the column count', async () => {
    const latin1 = Buffer.from('C001|O"BRIEN PAC|caf\xe9\n', 'latin1');
    expect(await collect(fecPipeRows(Readable.from([latin1]), 3))).toEqual([
      ['C001', 'O"BRIEN PAC', 'café'],
    ]);
    await expect(collect(fecPipeRows(Readable.from(['a|b\n']), 3))).rejects.toThrow(
      /expected 3 columns/,
    );
  });

  it('reads header CSV with lower-cased keys and fails on missing columns', async () => {
    const csv = '"CAND_ID","Exp_Amo"\n"H1","1.5"\n';
    expect(await collect(headerCsvRows(Readable.from([csv]), ['cand_id']))).toEqual([
      { cand_id: 'H1', exp_amo: '1.5' },
    ]);
    await expect(collect(headerCsvRows(Readable.from([csv]), ['spe_id']))).rejects.toThrow(
      /spe_id/,
    );
  });
});
