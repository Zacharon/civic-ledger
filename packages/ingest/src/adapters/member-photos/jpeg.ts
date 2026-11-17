/**
 * Minimal JPEG inspection (no dependency): proves a byte string really is a complete JPEG
 * and reads its pixel size from the frame header (SOFn marker). Anything else is rejected
 * with a reason; the file is never decoded or re-encoded.
 */

export interface JpegInfo {
  width: number;
  height: number;
  /** 1 = grayscale, 3 = colour, 4 = CMYK (browsers decode it; one real file uses it). */
  components: number;
  progressive: boolean;
}

export class JpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JpegError';
  }
}

/** Frame-header markers: every SOFn except DHT (C4), JPG (C8) and DAC (CC). */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * Reads a JPEG's frame header. Throws `JpegError` unless the bytes start with SOI, contain
 * a well-formed frame header and scan, and end with EOI (so a truncated download fails).
 */
export function inspectJpeg(bytes: Uint8Array): JpegInfo {
  if (bytes.length < 125) throw new JpegError(`too small to be a JPEG (${bytes.length} bytes)`);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new JpegError('not a JPEG: missing the start-of-image marker');
  }
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new JpegError('truncated JPEG: missing the end-of-image marker');
  }

  let frame: JpegInfo | null = null;
  let sawScan = false;
  let offset = 2;
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff)
      throw new JpegError(`malformed JPEG: expected a marker at ${offset}`);
    let marker = bytes[offset + 1] ?? 0;
    // Any number of 0xFF fill bytes may precede a marker.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset++;
      marker = bytes[offset + 1] ?? 0;
    }
    offset += 2;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length field
    if (offset + 2 > bytes.length) throw new JpegError('truncated JPEG: segment length missing');
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) {
      throw new JpegError(`malformed JPEG: bad segment length ${length} for marker ${marker}`);
    }
    if (isStartOfFrame(marker)) {
      if (frame) throw new JpegError('malformed JPEG: more than one frame header');
      if (length < 8) throw new JpegError('malformed JPEG: short frame header');
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const components = bytes[offset + 7] ?? 0;
      if (width === 0 || height === 0) {
        throw new JpegError('malformed JPEG: zero width or height');
      }
      if (components !== 1 && components !== 3 && components !== 4) {
        throw new JpegError(`unsupported JPEG: ${components} colour components`);
      }
      frame = { width, height, components, progressive: marker === 0xc2 || marker === 0xc6 };
    }
    offset += length;
    if (marker === 0xda) {
      // Entropy-coded data follows the scan header; the image is complete once it ends in EOI.
      sawScan = true;
      break;
    }
  }
  if (!frame) throw new JpegError('malformed JPEG: no frame header');
  if (!sawScan) throw new JpegError('malformed JPEG: no scan data');
  return frame;
}

// ---------------------------------------------------------------------------------------
// Metadata stripping (privacy). The pixels are never touched: the file is copied segment by
// segment, dropping only the segments that carry metadata, so there is no re-encoding.
// ---------------------------------------------------------------------------------------

export interface StripResult {
  bytes: Uint8Array;
  /** Bytes taken out (`original.length - bytes.length`). */
  removedBytes: number;
  /** An EXIF block with a non-empty GPS IFD was present. */
  hadGps: boolean;
  /** An embedded thumbnail (EXIF IFD1 or JFIF/JFXX) was present. */
  hadThumbnail: boolean;
  /** An EXIF/XMP (APP1) block was present. */
  hadExif: boolean;
  /** Segments dropped, by marker name (`APP1`, `APP13`, `COM`, ...). */
  dropped: Record<string, number>;
}

const ascii = (bytes: Uint8Array, start: number, text: string): boolean =>
  text.split('').every((ch, i) => bytes[start + i] === ch.charCodeAt(0));

function readTiff(payload: Uint8Array): { gps: boolean; thumbnail: boolean } {
  // payload = TIFF header + IFDs (after "Exif\0\0").
  const little = payload[0] === 0x49 && payload[1] === 0x49;
  if (!little && !(payload[0] === 0x4d && payload[1] === 0x4d))
    return { gps: false, thumbnail: false };
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const result = { gps: false, thumbnail: false };
  try {
    if (u16(2) !== 42) return result;
    const ifd0 = u32(4);
    const count0 = u16(ifd0);
    for (let i = 0; i < count0; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (u16(entry) === 0x8825) {
        const gps = u32(entry + 8);
        result.gps = gps + 2 <= payload.length && u16(gps) > 0;
      }
    }
    const ifd1 = u32(ifd0 + 2 + count0 * 12);
    if (ifd1 > 0 && ifd1 + 2 <= payload.length) {
      const count1 = u16(ifd1);
      for (let i = 0; i < count1; i++) {
        const tag = u16(ifd1 + 2 + i * 12);
        if (tag === 0x0201 || tag === 0x0111) result.thumbnail = true;
      }
    }
  } catch {
    // A malformed EXIF block is dropped like any other; its contents just are not counted.
  }
  return result;
}

const markerName = (marker: number): string =>
  marker >= 0xe0 && marker <= 0xef
    ? `APP${marker - 0xe0}`
    : marker === 0xfe
      ? 'COM'
      : `0x${marker.toString(16)}`;

/**
 * Copies a (validated) JPEG without its metadata and without re-encoding it:
 *
 * - kept: APP0 JFIF (its embedded thumbnail is zeroed), APP2 ICC profile, APP14 Adobe (CMYK
 *   files need it to decode), and every structural segment (DQT, SOFn, DHT, DRI, SOS, ...) and
 *   all entropy-coded data byte for byte;
 * - dropped: APP1 (EXIF, XMP: camera serials, photographer, edit history, GPS, thumbnails),
 *   APP13 (Photoshop/IPTC), COM comments, JFXX thumbnails, and every other APPn.
 *
 * The caller must run `inspectJpeg` on the result.
 */
export function stripJpegMetadata(input: Uint8Array): StripResult {
  const out: Uint8Array[] = [input.subarray(0, 2)]; // SOI
  const dropped: Record<string, number> = {};
  let hadGps = false;
  let hadThumbnail = false;
  let hadExif = false;
  const drop = (marker: number) => {
    const name = markerName(marker);
    dropped[name] = (dropped[name] ?? 0) + 1;
  };

  let pos = 2;
  while (pos < input.length - 1) {
    if (input[pos] !== 0xff) throw new JpegError(`malformed JPEG: expected a marker at ${pos}`);
    let marker = input[pos + 1] ?? 0;
    if (marker === 0xff) {
      pos++; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      out.push(input.subarray(pos, pos + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      out.push(input.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    const length = ((input[pos + 2] ?? 0) << 8) | (input[pos + 3] ?? 0);
    const end = pos + 2 + length;
    if (length < 2 || end > input.length) throw new JpegError('malformed JPEG: bad segment length');
    const payload = input.subarray(pos + 4, end);
    marker = input[pos + 1] ?? 0;

    let keep = true;
    let segment = input.subarray(pos, end);
    if (marker === 0xe0) {
      if (ascii(payload, 0, 'JFIF\0')) {
        const thumbW = payload[12] ?? 0;
        const thumbH = payload[13] ?? 0;
        if (thumbW > 0 || thumbH > 0) {
          hadThumbnail = true;
          const rewritten = Uint8Array.from(input.subarray(pos, pos + 4 + 14));
          rewritten[2] = 0;
          rewritten[3] = 16; // length of a JFIF header with no thumbnail
          rewritten[4 + 12] = 0;
          rewritten[4 + 13] = 0;
          segment = rewritten;
        }
      } else {
        if (ascii(payload, 0, 'JFXX\0')) hadThumbnail = true;
        keep = false;
      }
    } else if (marker === 0xe2) {
      keep = ascii(payload, 0, 'ICC_PROFILE\0');
    } else if (marker === 0xee) {
      keep = ascii(payload, 0, 'Adobe');
    } else if (marker === 0xe1) {
      keep = false;
      hadExif = true;
      if (ascii(payload, 0, 'Exif\0\0')) {
        const tiff = readTiff(payload.subarray(6));
        hadGps ||= tiff.gps;
        hadThumbnail ||= tiff.thumbnail;
      }
    } else if ((marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe) {
      keep = false;
    }
    if (keep) out.push(segment);
    else drop(marker);
    pos = end;

    if (marker === 0xda) {
      // Entropy-coded data: copy verbatim up to the next real marker (not a stuffed 0xFF00,
      // a restart marker or fill).
      const start = pos;
      while (pos < input.length - 1) {
        if (input[pos] === 0xff) {
          const next = input[pos + 1] ?? 0;
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            pos += 2;
            continue;
          }
          if (next === 0xff) {
            pos++;
            continue;
          }
          break;
        }
        pos++;
      }
      out.push(input.subarray(start, pos));
    }
  }

  const total = out.reduce((n, part) => n + part.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of out) {
    bytes.set(part, at);
    at += part.length;
  }
  return {
    bytes,
    removedBytes: input.length - bytes.length,
    hadGps,
    hadThumbnail,
    hadExif,
    dropped,
  };
}
