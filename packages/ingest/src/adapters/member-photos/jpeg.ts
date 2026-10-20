/**
 * Minimal JPEG inspection (no dependency): proves a byte string really is a complete JPEG
 * and reads its pixel size from the frame header (SOFn marker). Anything else is rejected
 * with a reason; the file is never decoded or re-encoded.
 */

export interface JpegInfo {
  width: number;
  height: number;
  /** 1 = grayscale, 3 = colour. */
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
      if (components !== 1 && components !== 3) {
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
