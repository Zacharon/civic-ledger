import 'server-only';
import {
  CapabilityError,
  type CapabilityInput,
  type CapabilityName,
  type CapabilityOutput,
  dispatch,
  registry,
} from '@civic-ledger/core';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import { webContext } from './db';

/**
 * The web UI's only path to data: core capabilities through the registry.
 * Pages never import the database; they call `read(name, input)`.
 */

// Deduplicates identical reads within one request (e.g. the footer and a page both
// asking for sources.status). Keyed by a JSON string because `cache` compares by identity.
const cachedRead = cache(async (name: CapabilityName, inputJson: string) => {
  const capability = registry[name];
  if (capability.audience !== 'public') {
    throw new CapabilityError('not_found', `Capability "${name}" is not public`);
  }
  return dispatch(name, JSON.parse(inputJson), webContext());
});

/** Runs a public read capability for the current request (always dynamic: data changes). */
export async function read<N extends CapabilityName>(
  name: N,
  input: CapabilityInput<N>,
): Promise<CapabilityOutput<N>> {
  await connection();
  const output = await cachedRead(name, JSON.stringify(input ?? {}));
  // `cachedRead` widens to the union; the registry entry for N fixes the precise type.
  return output as CapabilityOutput<N>;
}

/** Same as `read`, but a `not_found` capability error renders the route's 404 page. */
export async function readOrNotFound<N extends CapabilityName>(
  name: N,
  input: CapabilityInput<N>,
): Promise<CapabilityOutput<N>> {
  try {
    return await read(name, input);
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'not_found') notFound();
    throw error;
  }
}

/** For URL-driven input that may be invalid: returns the capability error instead of throwing. */
export async function readOrInvalid<N extends CapabilityName>(
  name: N,
  input: CapabilityInput<N>,
): Promise<{ ok: true; data: CapabilityOutput<N> } | { ok: false; error: CapabilityError }> {
  try {
    return { ok: true, data: await read(name, input) };
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'invalid_input') {
      return { ok: false, error };
    }
    throw error;
  }
}
