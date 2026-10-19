import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { IngestRunReceipt } from '@civic-ledger/core';
import { expect } from 'vitest';
import { hashFile } from '../../src/runtime/download';
import type { HttpDeps } from '../../src/runtime/http';
import { MANIFEST_FILE, snapshotChecksum } from '../../src/runtime/snapshot';
import { FIXTURES } from '../helpers';

/**
 * Evidence-trust (T-A) test support: an in-process HTTP double whose files can change
 * between runs, and helpers that locate and re-verify a run's raw evidence. No request
 * leaves the process.
 */
export interface EvidenceServer {
  deps: HttpDeps;
  /** Current body per URL basename; replace an entry to "publish" a changed file upstream. */
  files: Map<string, Buffer>;
  /** When set, every request answers this HTTP status (e.g. 503 to fail a fetch). */
  failWith: number | null;
  requests: { name: string; conditional: boolean; status: number }[];
}

/** Serves `files` by URL basename with content ETags; 304 when If-None-Match matches. */
export async function evidenceServer(fixtureDir: string): Promise<EvidenceServer> {
  const files = new Map<string, Buffer>();
  for (const name of await readdir(join(FIXTURES, fixtureDir))) {
    files.set(name, await readFile(join(FIXTURES, fixtureDir, name)));
  }
  const server: EvidenceServer = {
    files,
    failWith: null,
    requests: [],
    deps: {
      fetch: async (input, init) => {
        const name = String(input).split('/').at(-1) ?? '';
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const conditional = Boolean(headers['if-none-match']);
        const answer = (status: number, body: BodyInit | null, h: Record<string, string> = {}) => {
          server.requests.push({ name, conditional, status });
          return new Response(body, { status, headers: h });
        };
        if (server.failWith !== null) return answer(server.failWith, 'unavailable');
        const body = server.files.get(name);
        if (!body) return answer(404, 'not found');
        const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
        if (headers['if-none-match'] === etag) return answer(304, null);
        return answer(200, new Uint8Array(body), { etag });
      },
      sleep: async () => {},
      random: () => 0,
    },
  };
  return server;
}

/** Returns a copy of a legislators file with the first member renamed (a changed upstream). */
export function renamedLegislators(body: Buffer, name: string): Buffer {
  const people = JSON.parse(body.toString('utf8')) as { name: { official_full?: string } }[];
  const first = people[0];
  if (!first) throw new Error('empty legislators fixture');
  first.name.official_full = name;
  return Buffer.from(JSON.stringify(people));
}

type Receipt = IngestRunReceipt & { snapshotLocator?: string | null };

/**
 * Where a run's raw evidence lives. Uses the receipt's `snapshotLocator`; without one (the
 * baseline build) it falls back to the only place the baseline writes: `<source>/<day>`.
 */
export function evidenceDirectory(rawRoot: string, receipt: Receipt): string {
  const locator = receipt.snapshotLocator;
  if (locator) return isAbsolute(locator) ? locator : join(rawRoot, ...locator.split('/'));
  return join(rawRoot, receipt.source, receipt.startedAt.slice(0, 10));
}

interface ManifestFile {
  fileName: string;
  sha256: string;
  bytes: number;
}

/**
 * Re-verifies a run's retained evidence: the manifest names the run's checksum, every file
 * rehashes to its recorded sha256 and size, and the files + upstream ids recompute the
 * checksum. Returns the manifest for further checks.
 */
export async function expectEvidenceIntact(
  rawRoot: string,
  receipt: Receipt,
  directory = evidenceDirectory(rawRoot, receipt),
): Promise<Record<string, unknown>> {
  const manifest = JSON.parse(await readFile(join(directory, MANIFEST_FILE), 'utf8')) as {
    checksum: string;
    upstream: Record<string, number | null>;
    files: ManifestFile[];
  };
  expect(manifest.checksum, `manifest checksum of run ${receipt.runId}`).toBe(
    receipt.snapshotChecksum,
  );
  const rehashed: ManifestFile[] = [];
  for (const file of manifest.files) {
    const actual = await hashFile(join(directory, file.fileName));
    expect(actual, `${file.fileName} of run ${receipt.runId}`).toEqual({
      sha256: file.sha256,
      bytes: file.bytes,
    });
    rehashed.push({ fileName: file.fileName, ...actual });
  }
  expect(snapshotChecksum(rehashed, manifest.upstream)).toBe(receipt.snapshotChecksum);
  return manifest as unknown as Record<string, unknown>;
}
