import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { canonical } from './record';

const MAGIC = Buffer.from('CIVICBK2');
const HEADER_BYTES = 8 + 16 + 12;
export const KEY_PATTERN =
  /^(daily|weekly)\/civic-ledger-\d{8}T\d{9}Z-[a-f0-9]{8}\.(dump\.enc|record\.enc|manifest\.json)$/;
export interface ArchiveFile {
  key: string;
  bytes: number;
  sha256: string;
}
export interface Manifest {
  version: 2;
  id: string;
  takenAt: string;
  recordDate: string;
  sourceIdentitySha256: string;
  files: { dump: ArchiveFile; record: ArchiveFile };
  cipher: 'aes-256-gcm+scrypt';
  hmac: string;
}

export function checkSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32)
    throw new Error('BACKUP_ENCRYPTION_KEY must contain at least 32 bytes from a secret store');
}
export function checkKey(key: string): void {
  const raw = /^raw\/civic-ledger-\d{8}T\d{9}Z-[a-f0-9]{8}\/(?:[a-f0-9]{64}\.enc|manifest\.json)$/;
  if (!KEY_PATTERN.test(key) && !raw.test(key))
    throw new Error('refusing object key outside the Civic Ledger daily/weekly archive format');
}
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function signManifest(value: Omit<Manifest, 'hmac'>, secret: string): Manifest {
  checkSecret(secret);
  return { ...value, hmac: createHmac('sha256', secret).update(canonical(value)).digest('hex') };
}
export function verifyManifest(value: unknown, secret: string): Manifest {
  checkSecret(secret);
  if (!value || typeof value !== 'object')
    throw new Error('backup manifest is missing or malformed');
  const m = value as Manifest;
  if (
    m.version !== 2 ||
    m.cipher !== 'aes-256-gcm+scrypt' ||
    !/^civic-ledger-\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(m.id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(m.recordDate) ||
    !Number.isFinite(Date.parse(m.takenAt)) ||
    !/^[a-f0-9]{64}$/.test(m.sourceIdentitySha256) ||
    !m.files
  ) {
    throw new Error('backup manifest is missing or malformed');
  }
  for (const kind of ['dump', 'record'] as const) {
    const file = m.files[kind];
    if (!file || typeof file.key !== 'string') throw new Error('backup manifest file is missing');
    checkKey(file.key);
    if (
      !file.key.endsWith(`/${m.id}.${kind}.enc`) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 52 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error('backup manifest file metadata is invalid');
    }
  }
  if (typeof m.hmac !== 'string' || !/^[a-f0-9]{64}$/.test(m.hmac))
    throw new Error('backup manifest authentication is missing');
  const { hmac, ...unsigned } = m;
  const expected = signManifest(unsigned, secret).hmac;
  if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex')))
    throw new Error('backup manifest authentication failed');
  return m;
}
export async function verifyArchiveFile(path: string, file: ArchiveFile): Promise<void> {
  if ((await stat(path)).size !== file.bytes || (await hashFile(path)) !== file.sha256)
    throw new Error('encrypted backup size/checksum mismatch');
}
export async function encryptFile(input: string, output: string, secret: string): Promise<void> {
  checkSecret(secret);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(secret, salt, 32), iv);
  cipher.setAAD(header);
  const target = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  target.write(header);
  await pipeline(createReadStream(input), cipher, target);
  await appendFile(output, cipher.getAuthTag());
}
export async function decryptFile(input: string, output: string, secret: string): Promise<void> {
  checkSecret(secret);
  const size = (await stat(input)).size;
  if (size < HEADER_BYTES + 16) throw new Error('encrypted backup is truncated');
  const source = await open(input, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(16);
  try {
    await source.read(header, 0, header.length, 0);
    await source.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await source.close();
  }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('encrypted backup format is invalid');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    scryptSync(secret, header.subarray(8, 24), 32),
    header.subarray(24),
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  // Exclusive ownership precedes cleanup; EEXIST must preserve a human file.
  const destination = await open(output, 'wx', 0o600);
  try {
    if (size === HEADER_BYTES + 16) decipher.final();
    else
      await pipeline(
        createReadStream(input, { start: HEADER_BYTES, end: size - 17 }),
        decipher,
        destination.createWriteStream(),
      );
    await destination.close();
  } catch {
    await destination.close();
    await rm(output, { force: true });
    throw new Error('encrypted backup authentication failed');
  }
}
