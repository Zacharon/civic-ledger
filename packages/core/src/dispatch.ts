import type { z } from 'zod';
import {
  type CapabilityName,
  isCapabilityName,
  type Registry,
  registry,
} from './capabilities/registry';
import type { Capability, CapabilityContext } from './capability';
import { CapabilityError, invalidInput } from './errors';

export type CapabilityInput<N extends CapabilityName> = z.input<Registry[N]['input']>;
export type CapabilityOutput<N extends CapabilityName> = z.output<Registry[N]['output']>;

/**
 * Runs a capability: validates input, calls the handler, validates output.
 * Every failure surfaces as a CapabilityError; unexpected errors become `internal`
 * with the original kept as `cause` for logging.
 */
export async function dispatch<N extends CapabilityName>(
  name: N,
  input: unknown,
  ctx: CapabilityContext,
): Promise<CapabilityOutput<N>> {
  // Widened once here; the registry entry for N guarantees the precise output type.
  const output = await run(registry[name], input, ctx);
  return output as CapabilityOutput<N>;
}

/** Same as `dispatch` for names arriving as untrusted strings (URL paths, MCP tool names). */
export async function dispatchByName(
  name: string,
  input: unknown,
  ctx: CapabilityContext,
): Promise<unknown> {
  if (!isCapabilityName(name))
    throw new CapabilityError('not_found', `Unknown capability "${name}"`);
  return run(registry[name], input, ctx);
}

async function run(
  capability: Capability,
  input: unknown,
  ctx: CapabilityContext,
): Promise<unknown> {
  const parsedInput = capability.input.safeParse(input);
  if (!parsedInput.success) throw invalidInput(parsedInput.error);

  let result: unknown;
  try {
    result = await capability.handler(ctx, parsedInput.data);
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    throw new CapabilityError('internal', `${capability.name} failed`, { cause: error });
  }

  const parsedOutput = capability.output.safeParse(result);
  if (!parsedOutput.success) {
    throw new CapabilityError('internal', `${capability.name} produced invalid output`, {
      cause: parsedOutput.error,
    });
  }
  return parsedOutput.data;
}
