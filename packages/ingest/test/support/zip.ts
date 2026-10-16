import { writeFile } from 'node:fs/promises';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Minimal single-entry zip writer for tests (no dependency): an FEC-style archive with one
 * entry, deflated or stored. Enough for yauzl; no zip64, no timestamps.
 */
export function zipBuffer(entryName: string, content: Buffer, deflate = true): Buffer {
  const name = Buffer.from(entryName, 'utf8');
  const data = deflate ? deflateRawSync(content) : content;
  const crc = crc32(content);
  const method = deflate ? 8 : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, name, data, central, name, end]);
}

export async function writeZip(
  path: string,
  entryName: string,
  content: string | Buffer,
): Promise<void> {
  await writeFile(
    path,
    zipBuffer(entryName, typeof content === 'string' ? Buffer.from(content, 'latin1') : content),
  );
}
