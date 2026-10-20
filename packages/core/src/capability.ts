import type { Db } from '@civic-ledger/db';
import type { z } from 'zod';

export interface CapabilityContext {
  db: Db;
}

/**
 * `public` capabilities may be exposed by the web UI, `/api/v1` and MCP.
 * `operator` capabilities run only from trusted CLIs and must never be exposed publicly.
 */
export type Audience = 'public' | 'operator';

/**
 * How an adapter must carry the output. `json` (default): serialize it. `binary`: the output
 * has a `bytes` field plus `contentType` and `sha256`; adapters send the bytes as that media
 * type (HTTP body, MCP image block) and must not JSON-serialize them.
 */
export type Transport = 'json' | 'binary';

export interface Capability<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  version: number;
  kind: 'read' | 'write';
  audience: Audience;
  /** Omitted = `json`. */
  transport?: Transport;
  summary: string;
  input: I;
  output: O;
  // Method syntax keeps handlers assignable to the registry's widened type.
  handler(ctx: CapabilityContext, input: z.output<I>): Promise<z.input<O>>;
}

export function defineCapability<I extends z.ZodType, O extends z.ZodType>(
  capability: Capability<I, O>,
): Capability<I, O> {
  return capability;
}
