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

export interface Capability<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  version: number;
  kind: 'read' | 'write';
  audience: Audience;
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
