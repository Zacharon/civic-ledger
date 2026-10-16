import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbHandle } from '@civic-ledger/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RawSnapshot } from '../src/adapter';
import { ADAPTERS } from '../src/adapters/registry';
import { zipEntry } from '../src/parse/zip';
import type { HttpDeps } from '../src/runtime/http';
import { runIngest } from '../src/runtime/run';
import { FIXTURES, freshDb, ingestFixture, SCOPES, testRuntime } from './helpers';
import { writeZip } from './support/zip';

/**
 * H3-05: FEC pas2 / IE parsing must stream (no whole-file arrays before the first record
 * is handed on), and downloads / decompression must stop at a byte cap with a failed
 * receipt instead of growing without bound.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

async function fecCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civic-bounded-'));
  await cp(join(FIXTURES, 'fec-bulk'), dir, { recursive: true });
  return dir;
}

const snapshotOf = (directory: string): RawSnapshot => ({
  source: 'fec-bulk',
  directory,
  files: [],
  upstream: {},
  checksum: 'test',
  retrievedAt: new Date(),
});

/** Kinds the FEC parser yielded before it threw. */
async function kindsBeforeError(directory: string): Promise<{ kinds: string[]; error: unknown }> {
  const kinds: string[] = [];
  try {
    for await (const record of ADAPTERS['fec-bulk'].parse(
      snapshotOf(directory),
      SCOPES['fec-bulk'],
    )) {
      const r = record as { kind: string; pas2?: unknown };
      kinds.push(r.kind === 'stats' && r.pas2 ? 'stats:pas2' : r.kind);
    }
  } catch (error) {
    return { kinds, error };
  }
  return { kinds, error: null };
}

async function firstPas2Line(): Promise<string> {
  let text = '';
  for await (const stream of zipEntry(join(FIXTURES, 'fec-bulk', 'pas226.zip'), 'itpas2.txt')) {
    for await (const chunk of stream) text += (chunk as Buffer).toString('latin1');
  }
  const [line] = text.split('\n');
  if (!line) throw new Error('empty pas2 fixture');
  return line;
}

describe('streaming FEC parse (H3-05)', () => {
  it('hands on pas2 rows before reading the whole pas2 file', async () => {
    const dir = await fecCopy();
    await writeZip(
      join(dir, 'pas226.zip'),
      'itpas2.txt',
      `${await firstPas2Line()}\nnot|enough|columns\n`,
    );
    const { kinds, error } = await kindsBeforeError(dir);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/expected 22 columns/);
    const lastSummary = kinds.lastIndexOf('summary');
    expect(lastSummary).toBeGreaterThanOrEqual(0);
    expect(kinds.length - 1 - lastSummary).toBeGreaterThan(0);
  });

  it('hands on independent-expenditure rows before reading the whole IE file', async () => {
    const dir = await fecCopy();
    const iePath = join(dir, 'independent_expenditure_2026.csv');
    const lines = (await readFile(iePath, 'utf8')).trimEnd().split('\n');
    await writeFile(iePath, `${lines.slice(0, 3).join('\n')}\na,b,c\n`);
    const { kinds, error } = await kindsBeforeError(dir);
    expect(error).toBeInstanceOf(Error);
    const afterPas2 = kinds.length - 1 - kinds.indexOf('stats:pas2');
    expect(kinds.indexOf('stats:pas2')).toBeGreaterThanOrEqual(0);
    expect(afterPas2).toBeGreaterThan(0);
  });
});

describe('byte caps (H3-05)', () => {
  it('fails a download that exceeds the per-file byte cap', async () => {
    const big = Buffer.alloc(4_096, 'x');
    const deps: HttpDeps = {
      fetch: async () => new Response(big, { status: 200 }),
      sleep: async () => {},
      random: () => 0,
    };
    const rt = await testRuntime(handle, { http: deps, limits: { maxDownloadBytes: 1_024 } });
    const receipt = await runIngest({ source: 'voteview', scope: SCOPES.voteview }, rt);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/exceeds the 1024-byte download cap/);
  });

  it('fails a zip entry that inflates past the decompression cap', async () => {
    const rt = await testRuntime(handle, { limits: { maxDecompressedBytes: 200 } });
    await ingestFixture(rt, 'congress-legislators');
    const receipt = await ingestFixture(rt, 'fec-bulk');
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/exceeds the 200-byte decompression cap/);
  });
});
