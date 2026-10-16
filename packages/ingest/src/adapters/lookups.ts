import {
  type CHAMBERS,
  conflictUpdateSet,
  type Db,
  type IDENTIFIER_SCHEMES,
  office,
  personIdentifier,
} from '@civic-ledger/db';
import { eq } from 'drizzle-orm';

export type IdentifierScheme = (typeof IDENTIFIER_SCHEMES)[number];
export type Chamber = (typeof CHAMBERS)[number];

/** value → person id for one identifier scheme (e.g. every bioguide id). */
export async function identifierMap(
  db: Db,
  scheme: IdentifierScheme,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ value: personIdentifier.value, personId: personIdentifier.personId })
    .from(personIdentifier)
    .where(eq(personIdentifier.scheme, scheme));
  return new Map(rows.map((r) => [r.value, r.personId]));
}

export interface OfficeKey {
  chamber: Chamber;
  state: string;
  /** Senate: null. House: 0 = at-large or non-voting delegate; null = unknown (historical). */
  district: number | null;
}

export const officeKeyString = (o: OfficeKey): string =>
  `${o.chamber}|${o.state}|${o.district ?? ''}`;

/** Upserts federal offices on their natural key and caches their ids. */
export class OfficeResolver {
  private readonly ids = new Map<string, number>();

  async resolve(db: Db, keys: readonly OfficeKey[]): Promise<Map<string, number>> {
    const missing = new Map<string, OfficeKey>();
    for (const key of keys) {
      const k = officeKeyString(key);
      if (!this.ids.has(k)) missing.set(k, key);
    }
    if (missing.size > 0) {
      const rows = await db
        .insert(office)
        .values([...missing.values()].map((k) => ({ level: 'federal' as const, ...k })))
        .onConflictDoUpdate({
          target: [office.level, office.chamber, office.state, office.district],
          set: conflictUpdateSet(office),
        })
        .returning({
          id: office.id,
          chamber: office.chamber,
          state: office.state,
          district: office.district,
        });
      for (const row of rows) this.ids.set(officeKeyString(row), row.id);
    }
    return this.ids;
  }

  idFor(key: OfficeKey): number {
    const id = this.ids.get(officeKeyString(key));
    if (id === undefined) throw new Error(`Office not resolved: ${officeKeyString(key)}`);
    return id;
  }
}
