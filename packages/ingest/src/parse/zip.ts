import { type Readable, Transform } from 'node:stream';
import { finished } from 'node:stream/promises';
import { openPromise } from 'yauzl';

export interface ZipEntryStream {
  name: string;
  stream: Readable;
}

export interface ZipLimits {
  /** Largest inflated size of one entry (DECISIONS A53); a larger entry fails the parse. */
  maxBytes?: number;
}

/** Errors once more than `maxBytes` flowed through: guards against zip bombs and runaway files. */
function capped(source: Readable, label: string, maxBytes: number): Readable {
  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new Error(`${label} exceeds the ${maxBytes}-byte decompression cap`));
        return;
      }
      callback(null, chunk);
    },
  });
  source.on('error', (error) => counter.destroy(error));
  return source.pipe(counter);
}

/**
 * Streams the entries of a zip file one at a time (yauzl reads the central directory,
 * then inflates each entry on demand), so a large archive is never held in memory.
 * Each yielded stream is drained before the next entry is opened.
 */
export async function* zipEntries(
  path: string,
  accept: (name: string) => boolean = () => true,
  limits: ZipLimits = {},
): AsyncGenerator<ZipEntryStream> {
  const zip = await openPromise(path, { lazyEntries: true, autoClose: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith('/') || !accept(entry.fileName)) continue;
      const label = `${path.split(/[\\/]/).at(-1)}/${entry.fileName}`;
      if (limits.maxBytes !== undefined && entry.uncompressedSize > limits.maxBytes) {
        throw new Error(`${label} exceeds the ${limits.maxBytes}-byte decompression cap`);
      }
      const raw = await zip.openReadStreamPromise(entry);
      // The header size can lie; the counter enforces the cap on the bytes actually inflated.
      const stream = limits.maxBytes === undefined ? raw : capped(raw, label, limits.maxBytes);
      yield { name: entry.fileName, stream };
      if (!stream.readableEnded) {
        stream.resume();
        await finished(stream);
      }
    }
  } finally {
    if (zip.isOpen) zip.close();
  }
}

/** The single entry with `name` (case-insensitive) inside a zip; throws if absent. */
export async function* zipEntry(
  path: string,
  name: string,
  limits: ZipLimits = {},
): AsyncGenerator<Readable> {
  let found = false;
  for await (const entry of zipEntries(
    path,
    (n) => n.toLowerCase() === name.toLowerCase(),
    limits,
  )) {
    found = true;
    yield entry.stream;
  }
  if (!found) throw new Error(`${path} has no entry named ${name}`);
}
