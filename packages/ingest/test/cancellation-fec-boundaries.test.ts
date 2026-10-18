import type { DbHandle } from '@civic-ledger/db';
import { afterAll, beforeAll, describe } from 'vitest';
import { freshDb } from './helpers';
import { fecBoundaryScenarios } from './support/fec-boundary-scenarios';

/**
 * H3R3 (H3R2-02 residual) on PGlite: an abort after any statement of the FEC loader
 * (stage DROP / CREATE / INSERT, SQL dedupe, kept pages, page writes, each sweep DELETE)
 * stops the loader before its next statement and rolls everything back. The Postgres
 * twin is test-pg/cancellation-fec-boundaries.pgtest.ts.
 */
let handle: DbHandle;
beforeAll(async () => {
  handle = await freshDb();
});
afterAll(() => handle.close());

describe('FEC cancellation at every loader statement boundary (PGlite)', () => {
  fecBoundaryScenarios(() => handle);
});
