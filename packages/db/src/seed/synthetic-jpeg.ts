/**
 * A tiny, clearly synthetic baseline JPEG: one flat grey tone, no face, no content.
 * Used for the fictional development seed and test fixtures, so a real photo is never
 * attached to an invented person (DECISIONS A81). No image library is needed: every 8x8
 * block has the same DC value and no AC coefficients, so the entropy-coded data is a
 * few bits per block with custom (tiny) Huffman tables.
 */

const QUANT = 8;

function bitWriter() {
  const bytes: number[] = [];
  let acc = 0;
  let used = 0;
  return {
    write(code: number, length: number): void {
      for (let i = length - 1; i >= 0; i--) {
        acc = (acc << 1) | ((code >> i) & 1);
        used++;
        if (used === 8) {
          bytes.push(acc);
          if (acc === 0xff) bytes.push(0x00); // byte stuffing
          acc = 0;
          used = 0;
        }
      }
    },
    finish(): number[] {
      if (used > 0) {
        // Pad with 1-bits, as the standard requires.
        const padded = (acc << (8 - used)) | ((1 << (8 - used)) - 1);
        bytes.push(padded);
        if (padded === 0xff) bytes.push(0x00);
      }
      return bytes;
    },
  };
}

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];

function category(value: number): number {
  let magnitude = Math.abs(value);
  let bits = 0;
  while (magnitude > 0) {
    bits++;
    magnitude >>= 1;
  }
  return bits;
}

/** Baseline grayscale JPEG of exactly `width` x `height` pixels in one flat grey tone. */
export function syntheticGreyJpeg(width: number, height: number, grey = 192): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('width and height must be positive integers');
  }
  if (width > 0xffff || height > 0xffff) throw new Error('JPEG dimensions are limited to 65535');
  if (!Number.isInteger(grey) || grey < 0 || grey > 255) throw new Error('grey must be 0..255');

  // DC = 8 * (grey - 128) for the orthonormal 8x8 DCT; divided by the quantizer.
  const dc = Math.round((8 * (grey - 128)) / QUANT);
  const dcCategory = category(dc);
  const dcSymbols = [...new Set([0, dcCategory])].sort((a, b) => a - b);
  const dcCode = new Map(dcSymbols.map((symbol, index) => [symbol, index]));

  const writer = bitWriter();
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  for (let block = 0; block < blocks; block++) {
    const diff = block === 0 ? dc : 0;
    const cat = category(diff);
    writer.write(dcCode.get(cat) ?? 0, 2);
    if (cat > 0) writer.write(diff >= 0 ? diff : diff + (1 << cat) - 1, cat);
    writer.write(0, 1); // AC table: EOB is the only symbol, code "0"
  }
  const scan = writer.finish();

  const dht = (tableClass: number, counts: number[], symbols: number[]): number[] => [
    0xff,
    0xc4,
    ...be16(2 + 1 + 16 + symbols.length),
    tableClass << 4,
    ...counts,
    ...symbols,
  ];
  const dcCounts = new Array<number>(16).fill(0);
  dcCounts[1] = dcSymbols.length; // all DC codes are 2 bits long
  const acCounts = new Array<number>(16).fill(0);
  acCounts[0] = 1; // one 1-bit code: EOB

  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    ...be16(16),
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01,
    0x00,
    ...be16(1),
    ...be16(1),
    0x00,
    0x00,
    0xff,
    0xdb,
    ...be16(67),
    0x00,
    ...new Array<number>(64).fill(QUANT),
    0xff,
    0xc0,
    ...be16(11),
    0x08,
    ...be16(height),
    ...be16(width),
    0x01,
    0x01,
    0x11,
    0x00,
    ...dht(0, dcCounts, dcSymbols),
    ...dht(1, acCounts, [0x00]),
    0xff,
    0xda,
    ...be16(8),
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    ...scan,
    0xff,
    0xd9, // EOI
  ]);
}
