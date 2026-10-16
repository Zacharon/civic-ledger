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
      serializers: { err: pino.stdSerializers.err },
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
