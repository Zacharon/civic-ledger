import {
  attestReadOnlyCredentials,
  CapabilityError,
  createReadOnlyGate,
  type ReadOnlyAttestation,
  ReadOnlyCredentialsError,
} from '@civic-ledger/core';
import { webDbConfig } from './db-config';

type Env = Readonly<Record<string, string | undefined>>;
type Write = (line: string) => void;

declare global {
  // One attestation per server process, shared by instrumentation (startup) and every read.
  var __civicLedgerReadOnlyGate: (() => Promise<void>) | undefined;
}

const LEVEL: Record<ReadOnlyAttestation['action'], string> = {
  skipped: 'debug',
  accept: 'info',
  warn: 'warn',
  refuse: 'fatal',
  unverified: 'warn',
};

/** One fixed-shape JSON line: outcome and codes only. Never a URL, role name or driver text. */
export function attestationLine(attestation: ReadOnlyAttestation): string | null {
  if (attestation.action === 'skipped') return null;
  const line: Record<string, unknown> = {
    level: LEVEL[attestation.action],
    event: 'db.readonly_attestation',
    outcome: attestation.action,
  };
  if (attestation.action === 'unverified') {
    if (attestation.code) line.code = attestation.code;
    line.msg = 'read-only credentials not verified yet; retrying on the next read';
  } else {
    line.problems = attestation.problems;
    line.warnings = attestation.warnings;
    line.msg = attestation.message;
  }
  return `${JSON.stringify(line)}\n`;
}

function stderrWrite(line: string): void {
  process.stderr.write(line);
}

/** For tests: a gate over any attestation source and sink. */
export function createWebReadOnlyGate(
  attest: () => Promise<ReadOnlyAttestation>,
  write: Write = stderrWrite,
  production = true,
): () => Promise<void> {
  return createReadOnlyGate(
    attest,
    (attestation) => {
      const line = attestationLine(attestation);
      if (line) write(line);
    },
    // An attestation that cannot run blocks reads in production only (fail closed there).
    { blockUnverified: production },
  );
}

/** The process-wide gate over the web's own read-only configuration. */
export function webReadOnlyGate(env: Env = process.env): () => Promise<void> {
  globalThis.__civicLedgerReadOnlyGate ??= createWebReadOnlyGate(
    () => attestReadOnlyCredentials(webDbConfig(env), env),
    stderrWrite,
    env.NODE_ENV === 'production',
  );
  return globalThis.__civicLedgerReadOnlyGate;
}

/**
 * Runs before the first read of a request path. A refused login never serves data (the process
 * stays up so `/api/live` and the 503 readiness answer stay visible); unverified fails this
 * read like the database outage it almost always is, and is retried by the next.
 */
export async function passReadOnlyGate(gate: () => Promise<void>): Promise<void> {
  try {
    await gate();
  } catch (error) {
    const refused = error instanceof ReadOnlyCredentialsError && error.kind === 'refused';
    throw new CapabilityError(
      'internal',
      refused
        ? 'Service unavailable: the database credentials are not read-only. The cause is in the server log.'
        : 'The data service is unavailable. Try again.',
    );
  }
}

/** Startup: refused means exit; anything else lets the server start (first use re-checks). */
export async function startupReadOnlyProblem(gate: () => Promise<void>): Promise<string | null> {
  try {
    await gate();
    return null;
  } catch (error) {
    if (error instanceof ReadOnlyCredentialsError && error.kind === 'refused') return error.message;
    return null;
  }
}
