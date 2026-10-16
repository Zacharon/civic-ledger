import pino, { type Logger } from 'pino';

/** Structured JSON logs on stderr (stdout carries the receipt). No PII beyond public officials. */
export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino(
    { name: 'ingest', level, base: { service: 'civic-ledger-ingest' } },
    pino.destination(2),
  );
}

export const silentLogger: Logger = pino({ level: 'silent' });
