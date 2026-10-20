import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IngestScope } from '@civic-ledger/core';
import type { Db } from '@civic-ledger/db';
import { personIdentifier, term } from '@civic-ledger/db';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { FetchPlan, FetchRequest, PlanContext } from '../../adapter';
import { defaultHttpDeps, httpGet } from '../../runtime/http';

/** Files of the upstream repository (unitedstates/images, branch gh-pages). */
export const IMAGES_SITE = 'https://unitedstates.github.io/images/congress/';
export const TREE_URL =
  'https://api.github.com/repos/unitedstates/images/git/trees/gh-pages?recursive=1';

/** Variant folders, in the order they are stored. The names are pixel width x height. */
export const VARIANTS = [
  { folder: '225x275', width: 225, height: 275 },
  { folder: '450x550', width: 450, height: 550 },
] as const;
export type VariantFolder = (typeof VARIANTS)[number]['folder'];

/**
 * Who gets a portrait: every person with a Bioguide id who held a term that ended after the
 * 119th Congress began (2025-01-03), i.e. current members and those who left during it.
 * Widening this to all former members would store ~250 MB (DECISIONS A72).
 */
export const PORTRAITS_SINCE = '2025-01-03';

/** One file must stay far below the run-wide cap; real files are 20-200 KB. */
export const MAX_PORTRAIT_FILE_BYTES = 2 * 1024 * 1024;
/** All selected files together (by the repository listing), before anything is downloaded. */
export const DEFAULT_MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const MAX_LISTING_BYTES = 20 * 1024 * 1024;

const BIOGUIDE = /^[A-Z]\d{6}$/;
export const isBioguideId = (value: string): boolean => BIOGUIDE.test(value);

export const originUrl = (folder: VariantFolder, bioguide: string): string =>
  `${IMAGES_SITE}${folder}/${bioguide}.jpg`;

/** Bioguide ids in the portrait scope (see `PORTRAITS_SINCE`). */
export async function bioguideIdsInScope(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: personIdentifier.value })
    .from(personIdentifier)
    .where(
      and(
        eq(personIdentifier.scheme, 'bioguide'),
        sql`exists (select 1 from ${term} where ${term.personId} = ${personIdentifier.personId}
            and (${or(isNull(term.endDate), gt(term.endDate, PORTRAITS_SINCE))}))`,
      ),
    );
  return rows.map((r) => r.value).filter(isBioguideId);
}

interface TreeEntry {
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

/** `variant/BIOGUIDE` -> size in bytes, from the repository listing. */
export function filesInListing(listing: unknown): Map<string, number> {
  const tree = (listing as { tree?: unknown; truncated?: unknown } | null) ?? {};
  if (tree.truncated === true) {
    throw new Error(
      'The GitHub repository listing is truncated; the portrait list would be partial',
    );
  }
  if (!Array.isArray(tree.tree)) throw new Error('Unexpected repository listing: no "tree" array');
  const files = new Map<string, number>();
  for (const entry of tree.tree as TreeEntry[]) {
    if (entry.type !== 'blob' || typeof entry.path !== 'string') continue;
    const match = /^congress\/(225x275|450x550)\/([A-Z]\d{6})\.jpg$/.exec(entry.path);
    if (match && typeof entry.size === 'number') files.set(`${match[1]}/${match[2]}`, entry.size);
  }
  return files;
}

async function fetchListing(ctx: PlanContext): Promise<unknown> {
  const response = await httpGet(
    TREE_URL,
    {
      headers: { accept: 'application/vnd.github+json' },
      timeoutMs: 60_000,
      signal: ctx.signal,
      logger: ctx.logger,
    },
    ctx.http ?? defaultHttpDeps,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. The portrait list comes from the unauthenticated GitHub API (60 requests per hour per address); wait and rerun if it is a rate limit.`,
      { cause: error },
    );
  });
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (declared > MAX_LISTING_BYTES) {
    await response.body?.cancel();
    throw new Error(`Repository listing is ${declared} bytes, over the ${MAX_LISTING_BYTES} cap`);
  }
  const text = await response.text();
  if (text.length > MAX_LISTING_BYTES) throw new Error('Repository listing exceeds the size cap');
  return JSON.parse(text);
}

export function maxTotalBytesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INGEST_MAX_PORTRAIT_TOTAL_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_TOTAL_BYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`INGEST_MAX_PORTRAIT_TOTAL_BYTES must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** `--snapshot <dir>`: the files that directory holds, nothing else. */
async function planFromDirectory(scope: IngestScope, directory: string): Promise<FetchPlan> {
  const requests: FetchRequest[] = [];
  for (const { folder } of VARIANTS) {
    const names = await readdir(join(resolve(directory), folder)).catch(() => [] as string[]);
    for (const name of names.sort()) {
      if (name.endsWith('.jpg')) requests.push({ fileName: `${folder}/${name}` });
    }
  }
  if (requests.length === 0) {
    throw new Error(
      `Snapshot ${directory} has no ${VARIANTS.map((v) => v.folder).join(' or ')} .jpg files`,
    );
  }
  return { source: 'member-photos', scope, requests };
}

export async function planMemberPhotos(scope: IngestScope, ctx: PlanContext): Promise<FetchPlan> {
  if (ctx.snapshotPath) return planFromDirectory(scope, ctx.snapshotPath);
  if (!ctx.db)
    throw new Error('member-photos needs the database to choose whose portraits to fetch');

  const wanted = await bioguideIdsInScope(ctx.db);
  if (wanted.length === 0) {
    throw new Error(
      'No people with a Bioguide id and a term since 2025-01-03: run congress-legislators first',
    );
  }
  const listing = filesInListing(await fetchListing(ctx));
  const requests: FetchRequest[] = [];
  let totalBytes = 0;
  let withoutPair = 0;
  let noFile = 0;
  for (const bioguide of wanted.sort()) {
    const present = VARIANTS.filter((v) => listing.has(`${v.folder}/${bioguide}`));
    if (present.length === 0) {
      noFile++;
      continue;
    }
    if (present.length !== VARIANTS.length) {
      withoutPair++;
      continue;
    }
    for (const { folder } of present) {
      totalBytes += listing.get(`${folder}/${bioguide}`) ?? 0;
      requests.push({
        fileName: `${folder}/${bioguide}.jpg`,
        url: originUrl(folder, bioguide),
        timeoutMs: 60_000,
        maxBytes: MAX_PORTRAIT_FILE_BYTES,
      });
    }
  }
  const cap = maxTotalBytesFromEnv();
  if (totalBytes > cap) {
    throw new Error(
      `The selected portraits total ${totalBytes} bytes, over the ${cap}-byte INGEST_MAX_PORTRAIT_TOTAL_BYTES cap; nothing was downloaded`,
    );
  }
  ctx.logger?.info(
    { inScope: wanted.length, files: requests.length, noFile, withoutPair, totalBytes },
    'portrait selection',
  );
  if (requests.length === 0) {
    throw new Error('None of the people in scope has a portrait in the repository listing');
  }
  return { source: 'member-photos', scope, requests };
}
