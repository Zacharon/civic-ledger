import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParseContext, RawSnapshot } from '../../adapter';
import { inspectJpeg, JpegError } from './jpeg';
import {
  isBioguideId,
  MAX_PORTRAIT_FILE_BYTES,
  originUrl,
  VARIANTS,
  type VariantFolder,
} from './plan';

export interface PortraitFile {
  variant: VariantFolder;
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
  originUrl: string;
}

/** A person whose complete, validated pair of images was found in the snapshot. */
export interface PortraitRecord {
  kind: 'portrait';
  bioguide: string;
  files: PortraitFile[];
}

export type RejectReason =
  | 'bad_name'
  | 'incomplete_pair'
  | 'too_large'
  | 'not_jpeg'
  | 'wrong_size'
  | 'unreadable';

/** A person whose files were present but unusable. Nothing about them is stored. */
export interface RejectedRecord {
  kind: 'rejected';
  bioguide: string;
  reason: RejectReason;
  detail: string;
}

export type PortraitParsed = PortraitRecord | RejectedRecord;

/**
 * Validates each person's pair of images (225x275 and 450x550) before anything is stored: it
 * must be a complete JPEG (SOI ... EOI), within the per-file cap, and exactly the variant's
 * pixel size. One bad file rejects that person's pair; the rest still load. Files are read
 * one person at a time, so memory stays O(one pair).
 */
export async function* parseMemberPhotos(
  snapshot: RawSnapshot,
  _scope?: unknown,
  ctx: ParseContext = {},
): AsyncGenerator<PortraitParsed> {
  const byPerson = new Map<string, Map<VariantFolder, { name: string; bytes: number }>>();
  const badNames: string[] = [];
  for (const file of snapshot.files) {
    const match = /^(225x275|450x550)\/([^/]+)\.jpg$/.exec(file.fileName);
    const bioguide = match?.[2];
    if (!match || !bioguide || !isBioguideId(bioguide)) {
      badNames.push(file.fileName);
      continue;
    }
    const variants = byPerson.get(bioguide) ?? new Map();
    variants.set(match[1] as VariantFolder, { name: file.fileName, bytes: file.bytes });
    byPerson.set(bioguide, variants);
  }
  for (const name of badNames) {
    yield {
      kind: 'rejected',
      bioguide: name,
      reason: 'bad_name',
      detail: `unexpected file ${name}`,
    };
  }

  for (const bioguide of [...byPerson.keys()].sort()) {
    ctx.signal?.throwIfAborted();
    const found = byPerson.get(bioguide);
    if (!found) continue;
    const missing = VARIANTS.filter((v) => !found.has(v.folder));
    if (missing.length > 0) {
      yield {
        kind: 'rejected',
        bioguide,
        reason: 'incomplete_pair',
        detail: `missing ${missing.map((v) => v.folder).join(', ')}`,
      };
      continue;
    }
    const files: PortraitFile[] = [];
    let rejected: RejectedRecord | null = null;
    for (const variant of VARIANTS) {
      const entry = found.get(variant.folder);
      if (!entry) continue;
      if (entry.bytes > MAX_PORTRAIT_FILE_BYTES) {
        rejected = reject(bioguide, 'too_large', `${entry.name} is ${entry.bytes} bytes`);
        break;
      }
      let bytes: Uint8Array;
      try {
        bytes = await readFile(join(snapshot.directory, entry.name));
      } catch (error) {
        rejected = reject(bioguide, 'unreadable', `${entry.name}: ${(error as Error).message}`);
        break;
      }
      try {
        const info = inspectJpeg(bytes);
        if (info.width !== variant.width || info.height !== variant.height) {
          rejected = reject(
            bioguide,
            'wrong_size',
            `${entry.name} is ${info.width}x${info.height}, expected ${variant.folder}`,
          );
          break;
        }
        files.push({
          variant: variant.folder,
          bytes,
          width: info.width,
          height: info.height,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          originUrl: originUrl(variant.folder, bioguide),
        });
      } catch (error) {
        if (!(error instanceof JpegError)) throw error;
        rejected = reject(bioguide, 'not_jpeg', `${entry.name}: ${error.message}`);
        break;
      }
    }
    yield rejected ?? { kind: 'portrait', bioguide, files };
  }
}

function reject(bioguide: string, reason: RejectReason, detail: string): RejectedRecord {
  return { kind: 'rejected', bioguide, reason, detail };
}
