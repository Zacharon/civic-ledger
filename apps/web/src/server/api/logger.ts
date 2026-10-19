import pino, { type DestinationStream, type Logger } from 'pino';

export type { Logger } from 'pino';

export interface LoggerOptions {
  level?: string;
  destination?: DestinationStream;
}

/**
 * JSON logs on stdout. Request logs carry only an explicit allowlist of fields (id, capability,
 * status, duration); headers are never logged. The redaction list is a second line of defence
 * for anyone who adds a header-bearing field later.
 */
export function createLogger({ level, destination }: LoggerOptions = {}): Logger {
  const resolved =
    level ??
    process.env.LOG_LEVEL ??
    (process.env.VITEST || process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  return pino(
    {
      level: resolved,
      base: { service: 'civic-ledger-web' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      // Driver errors can embed connection URLs, SQL and parameters in both message
      // and stack. Keep a category and SQLSTATE, never serialize the raw exception.
      serializers: { err: safeErrorFields },
      redact: {
        paths: [
          'headers.authorization',
          'headers.cookie',
          'headers["set-cookie"]',
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["set-cookie"]',
          '*.authorization',
          '*.cookie',
        ],
        remove: true,
      },
    },
    destination,
  );
}

export function safeErrorFields(error: unknown): { type: string; code?: string } {
  const codes = new Set(['invalid_input', 'not_found', 'conflict', 'rate_limited', 'internal']);
  const types = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'CapabilityError']);
  try {
    const entry = error as { name?: unknown; code?: unknown } | null;
    const type = typeof entry?.name === 'string' && types.has(entry.name) ? entry.name : 'Error';
    const code = entry?.code;
    return {
      type,
      ...(typeof code === 'string' && (codes.has(code) || /^[0-9A-Z]{5}$/.test(code))
        ? { code }
        : {}),
    };
  } catch {
    return { type: 'Error' };
  }
}
