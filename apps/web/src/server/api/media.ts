import { matchesEtag } from './cache';
import { baseHeaders } from './http';

/** Output of a `transport: 'binary'` capability (the contract in core's `Capability`). */
export interface MediaResult {
  contentType: string;
  sha256: string;
  bytes: Uint8Array;
}

export function isMediaResult(value: unknown): value is MediaResult {
  const v = value as Partial<MediaResult> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.contentType === 'string' &&
    typeof v.sha256 === 'string' &&
    v.bytes instanceof Uint8Array
  );
}

/** Shortest cache-busting key (hex characters of the sha256) that earns `immutable`. */
const MIN_KEY_LENGTH = 8;

/** One year, the longest a cache may be told to keep a file whose address changes with its bytes. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Without a matching cache key the address does not identify the bytes: revalidate every time. */
const REVALIDATE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

/**
 * Cache policy of a media file. `immutable` is only promised when the caller's cache-busting
 * key (`v`) is the prefix of the sha256 of the bytes being sent, so a stale or invented key can
 * never pin a changed file in a cache.
 */
export function mediaCacheControl(sha256: string, key: string | undefined): string {
  return key && key.length >= MIN_KEY_LENGTH && sha256.startsWith(key) ? IMMUTABLE : REVALIDATE;
}

/**
 * HTTP form of a binary capability result: the bytes with their own content type, a strong
 * ETag equal to the sha256 (304 on a match), nosniff, and the cache policy above.
 */
export function mediaResponse(
  request: Request,
  result: MediaResult,
  requestId: string,
  cacheKey: string | undefined,
): Response {
  const etag = `"${result.sha256}"`;
  const headers = baseHeaders(requestId, {
    'content-type': result.contentType,
    'cache-control': mediaCacheControl(result.sha256, cacheKey),
    etag,
  });
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    headers.delete('content-type');
    return new Response(null, { status: 304, headers });
  }
  headers.set('content-length', String(result.bytes.byteLength));
  headers.set('content-disposition', 'inline');
  const body = request.method === 'HEAD' ? null : (result.bytes as Uint8Array<ArrayBuffer>);
  return new Response(body, { status: 200, headers });
}
