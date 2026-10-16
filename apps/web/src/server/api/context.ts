import type { CapabilityContext } from '@civic-ledger/core';
import { webContext } from '../db';

/** The API shares the UI's process-wide handle and database config, so both read the same state. */
export function getApiContext(): CapabilityContext {
  return webContext();
}
