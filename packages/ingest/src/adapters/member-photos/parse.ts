import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParseContext, RawSnapshot } from '../../adapter';
import { inspectJpeg, JpegError, stripJpegMetadata } from './jpeg';
import {
  fitsVariantBox,
  isBioguideId,
  MAX_PORTRAIT_FILE_BYTES,
  MIN_BOX_FILL,
  originUrl,
  VARIANTS,
  type VariantFolder,
} from './plan';

export interface PortraitFile {
  variant: VariantFolder;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** sha256 of `bytes` (metadata stripped): the ETag and cache key. */
  sha256: string;
  /** sha256 and size of the file exactly as downloaded: provenance. */
  originSha256: string;
  originBytes: number;
  originUrl: string;
  /** What stripping found and removed (for the receipt). */
  removedBytes: number;
  hadExif: boolean;
  hadGps: boolean;
  hadThumbnail: boolean;
}

/** A person with a validated 225x275 image and, when upstream has it, a 450x550 one. */
export interface PortraitRecord {
  kind: 'portrait';
  bioguide: string;
  files: PortraitFile[];
}

export type RejectReason =
  | 'bad_name'
  | 'missing_1x'
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
 * Validates each person's images before anything is stored. A file must be a complete JPEG
 * (SOI ... EOI), within the per-file cap, and inside its variant's pixel box (upstream fits
 * photos to the box, so widths vary). It is then copied without its metadata (EXIF/XMP, comments,
 * thumbnails; never re-encoded) and the stripped bytes are validated again; the stored sha256 is
 * the stripped file's, the downloaded file's sha256 is kept as provenance. The 225x275 file is
 * required, the 450x550 (the 2x source) optional. One bad file rejects that person (an earlier
 * good pair is kept by the loader); the rest still load. Files are read one person at a time,
 * so memory stays O(one pair).
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
    if (!found.has('225x275')) {
      yield {
        kind: 'rejected',
        bioguide,
        reason: 'missing_1x',
        detail: 'has a 450x550 file but no 225x275 file',
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
        if (!fitsVariantBox(info.width, info.height, variant)) {
          rejected = reject(
            bioguide,
            'wrong_size',
            `${entry.name} is ${info.width}x${info.height}, outside the ${variant.folder} box (at most that size, at least ${MIN_BOX_FILL * 100}% of its area)`,
          );
          break;
        }
        const stripped = stripJpegMetadata(bytes);
        const after = inspectJpeg(stripped.bytes);
        if (after.width !== info.width || after.height !== info.height) {
          throw new JpegError('stripping changed the image size');
        }
        files.push({
          variant: variant.folder,
          bytes: stripped.bytes,
          width: after.width,
          height: after.height,
          sha256: createHash('sha256').update(stripped.bytes).digest('hex'),
          originSha256: createHash('sha256').update(bytes).digest('hex'),
          originBytes: bytes.byteLength,
          originUrl: originUrl(variant.folder, bioguide),
          removedBytes: stripped.removedBytes,
          hadExif: stripped.hadExif,
          hadGps: stripped.hadGps,
          hadThumbnail: stripped.hadThumbnail,
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
