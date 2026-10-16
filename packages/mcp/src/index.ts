/**
 * MCP stdio server entry (phase 2). It must register exactly `publicCapabilities()`
 * from @civic-ledger/core as tools, reuse their zod schemas, and call `dispatchByName`;
 * it must never expose operator capabilities (ingest.run, curated.validate).
 * Tool names follow CAPABILITIES.md: `people.search` → `people_search`.
 */
export function toolNameFor(capabilityName: string): string {
  return capabilityName.replaceAll('.', '_');
}
