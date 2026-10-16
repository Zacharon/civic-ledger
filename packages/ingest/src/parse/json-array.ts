import type { Readable } from 'node:stream';

/**
 * Streams the elements of a top-level JSON array (`[ {...}, {...} ]`) without parsing the
 * whole document: a small scanner tracks string/escape state and nesting depth, and each
 * complete element's text is handed to JSON.parse. Memory is bounded by one element.
 */
export async function* jsonArrayElements(input: Readable): AsyncGenerator<unknown> {
  input.setEncoding('utf8');
  let started = false;
  let ended = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let element: string[] = [];
  let chunkStart = -1;

  for await (const chunk of input as AsyncIterable<string>) {
    chunkStart = depth > 0 ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (ended) {
        if (!/\s/.test(ch ?? '')) throw new Error('Unexpected content after the JSON array');
        continue;
      }
      if (!started) {
        if (ch === '[') started = true;
        else if (!/\s/.test(ch ?? '')) throw new Error('Expected a top-level JSON array');
        continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (depth === 0) {
        if (ch === ']') {
          ended = true;
        } else if (ch === '{' || ch === '[') {
          depth = 1;
          chunkStart = i;
        } else if (ch === '"') {
          throw new Error('Top-level scalar elements are not supported');
        } else if (ch !== ',' && !/\s/.test(ch ?? '')) {
          throw new Error(`Unexpected "${ch}" between array elements`);
        }
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          element.push(chunk.slice(chunkStart, i + 1));
          yield JSON.parse(element.join(''));
          element = [];
          chunkStart = -1;
        }
      }
    }
    if (depth > 0 && chunkStart >= 0) element.push(chunk.slice(chunkStart));
  }
  if (!started || !ended) throw new Error('Truncated JSON array');
}
