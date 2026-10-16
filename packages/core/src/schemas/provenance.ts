import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Provenance } from './common';

interface ProvenanceColumns {
  sourceId: string;
  sourceKey: string;
  ingestRunId: number;
  retrievedAt: Date;
}

/** Drizzle `select` shape for a fact table's provenance columns. */
export function provenanceFields<T extends Record<keyof ProvenanceColumns, AnyPgColumn>>(
  table: T,
): Pick<T, keyof ProvenanceColumns> {
  return {
    sourceId: table.sourceId,
    sourceKey: table.sourceKey,
    ingestRunId: table.ingestRunId,
    retrievedAt: table.retrievedAt,
  };
}

/** Moves a selected row's provenance columns into a nested wire-format `provenance` object. */
export function withProvenance<T extends ProvenanceColumns>({
  sourceId,
  sourceKey,
  ingestRunId,
  retrievedAt,
  ...rest
}: T): Omit<T, keyof ProvenanceColumns> & { provenance: Provenance } {
  return {
    ...rest,
    provenance: { sourceId, sourceKey, ingestRunId, retrievedAt: retrievedAt.toISOString() },
  };
}
