import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { openPromise } from 'yauzl';

export interface ZipEntryStream {
  name: string;
  stream: Readable;
}

/**
 * Streams the entries of a zip file one at a time (yauzl reads the central directory,
 * then inflates each entry on demand), so a large archive is never held in memory.
 * Each yielded stream is drained before the next entry is opened.
 */
export async function* zipEntries(
  path: string,
  accept: (name: string) => boolean = () => true,
): AsyncGenerator<ZipEntryStream> {
  const zip = await openPromise(path, { lazyEntries: true, autoClose: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith('/') || !accept(entry.fileName)) continue;
      const stream = await zip.openReadStreamPromise(entry);
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
export async function* zipEntry(path: string, name: string): AsyncGenerator<Readable> {
  let found = false;
  for await (const entry of zipEntries(path, (n) => n.toLowerCase() === name.toLowerCase())) {
    found = true;
    yield entry.stream;
  }
  if (!found) throw new Error(`${path} has no entry named ${name}`);
}
