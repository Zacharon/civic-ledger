import { CapabilityError } from '@civic-ledger/core';

export const MAX_BODY_BYTES = 256 * 1024;

export class BodyDeadlineError extends CapabilityError {
  constructor() {
    super('invalid_input', 'Request body timed out or was interrupted');
  }
}

export function bodyReadTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.API_BODY_TIMEOUT_MS;
  const value = raw === undefined ? 10_000 : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error('API_BODY_TIMEOUT_MS must be an integer from 1 to 120000');
  }
  return value;
}

function invalidBody(message: string): CapabilityError {
  return new CapabilityError('invalid_input', message, { issues: [{ path: '', message }] });
}

/** Deadline covers the entire body, including clients that keep sending tiny chunks. */
export async function readJsonBody(request: Request, timeoutMs: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw invalidBody('Content-Type must be application/json');
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw invalidBody(`Body exceeds ${MAX_BODY_BYTES} bytes`);
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () => {
        // A hostile source's cancel() can itself hang; never await it on the response path.
        void reader?.cancel().catch(() => {});
        reject(new BodyDeadlineError());
      };
      timer = setTimeout(interrupt, timeoutMs);
      request.signal.addEventListener('abort', interrupt, { once: true });
      if (request.signal.aborted) interrupt();
    });
    const consume = async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => {});
          throw invalidBody(`Body exceeds ${MAX_BODY_BYTES} bytes`);
        }
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw invalidBody('Body must be valid JSON');
      }
    };
    return await Promise.race([interrupted, consume()]);
  } finally {
    clearTimeout(timer);
    if (interrupt) request.signal.removeEventListener('abort', interrupt);
    reader?.releaseLock();
  }
}
