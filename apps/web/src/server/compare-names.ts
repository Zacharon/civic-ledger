import { CapabilityError } from '@civic-ledger/core';
import { read } from './capabilities';

export interface ComparedMember {
  slug: string;
  name: string;
}

/**
 * Names for the members chosen for Compare (at most four), in the order chosen. A slug
 * that no longer resolves is dropped rather than failing the page that carries it.
 */
export async function comparedNames(slugs: readonly string[]): Promise<ComparedMember[]> {
  const found = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return { slug, name: (await read('people.get', { slug })).person.fullName };
      } catch (error) {
        if (error instanceof CapabilityError && error.code === 'not_found') return null;
        throw error;
      }
    }),
  );
  return found.filter((m): m is ComparedMember => m !== null);
}
