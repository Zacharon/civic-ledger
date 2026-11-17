/**
 * Builds JPEG segments (EXIF with GPS and a thumbnail, comments, Photoshop data, ICC, Adobe)
 * and splices them into a synthetic JPEG, to test and to generate metadata-stripping fixtures.
 * Every value is invented: no real photo, camera or person.
 */
const bytesOf = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));
const le16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const le32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];

export function segment(marker: number, payload: ArrayLike<number>): Uint8Array {
  const length = payload.length + 2;
  return Uint8Array.from([0xff, marker, (length >> 8) & 255, length & 255, ...Array.from(payload)]);
}

/** APP1 EXIF (little-endian TIFF) with a camera serial string and optional GPS IFD / thumbnail. */
export function exifSegment(options: { gps: boolean; thumbnail: boolean }): Uint8Array {
  const entry = (tag: number, type: number, count: number, value: number[]): number[] => [
    ...le16(tag),
    ...le16(type),
    ...le32(count),
    ...value,
  ];
  const ifd0Entries = 1 + (options.gps ? 1 : 0);
  const make = bytesOf('SERIAL-0000-FAKE\0');
  const makeOffset = 8 + 2 + ifd0Entries * 12 + 4;
  const gpsOffset = makeOffset + make.length;
  const gpsSize = 2 + 12 + 4;
  const ifd1Offset = gpsOffset + (options.gps ? gpsSize : 0);
  const thumb = [0xff, 0xd8, 0xff, 0xd9];
  const tiff = [
    ...bytesOf('II'),
    ...le16(42),
    ...le32(8),
    ...le16(ifd0Entries),
    ...entry(0x010f, 2, make.length, le32(makeOffset)),
    ...(options.gps ? entry(0x8825, 4, 1, le32(gpsOffset)) : []),
    ...le32(options.thumbnail ? ifd1Offset : 0),
    ...make,
    ...(options.gps ? [...le16(1), ...entry(0x0001, 2, 2, [0x4e, 0, 0, 0]), ...le32(0)] : []),
    ...(options.thumbnail
      ? [...le16(1), ...entry(0x0201, 4, 1, le32(ifd1Offset + 18)), ...le32(0), ...thumb]
      : []),
  ];
  return segment(0xe1, [...bytesOf('Exif\0\0'), ...tiff]);
}

export const commentSegment = (text: string) => segment(0xfe, bytesOf(text));
export const photoshopSegment = () =>
  segment(0xed, bytesOf('Photoshop 3.0\0FAKE-IPTC-PHOTOGRAPHER'));
export const iccSegment = () => segment(0xe2, [...bytesOf('ICC_PROFILE\0'), 1, 1, 9, 9, 9, 9]);
export const adobeSegment = () => segment(0xee, [...bytesOf('Adobe'), 0, 100, 0, 0, 0, 0, 0]);
export const jfxxSegment = () => segment(0xe0, [...bytesOf('JFXX\0'), 0x10, 1, 2, 3, 4]);

/** Splices segments in after the JFIF header of a synthetic JPEG (SOI + 18-byte APP0). */
export function withSegments(jpeg: Uint8Array, segments: Uint8Array[]): Uint8Array {
  const at = 2 + 2 + 16;
  return Uint8Array.from([
    ...jpeg.subarray(0, at),
    ...segments.flatMap((s) => Array.from(s)),
    ...jpeg.subarray(at),
  ]);
}

/** Splices a segment in just before the final EOI (a comment after the scan, as some encoders do). */
export function withTrailingSegment(jpeg: Uint8Array, seg: Uint8Array): Uint8Array {
  return Uint8Array.from([
    ...jpeg.subarray(0, jpeg.length - 2),
    ...Array.from(seg),
    ...jpeg.subarray(jpeg.length - 2),
  ]);
}

/** Gives the JFIF header a 1x1 RGB thumbnail (3 more bytes). */
export function withJfifThumbnail(jpeg: Uint8Array): Uint8Array {
  const out = [...jpeg.subarray(0, 20), 1, 2, 3];
  out[5] = 19; // segment length (low byte): 16 + 3 thumbnail bytes
  out[6 + 12] = 1; // Xthumbnail
  out[6 + 13] = 1; // Ythumbnail
  return Uint8Array.from([...out, ...jpeg.subarray(20)]);
}
