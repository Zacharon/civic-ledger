/** `people.search` becomes the MCP tool name `people_search` (CAPABILITIES.md). */
export function toolNameFor(capabilityName: string): string {
  return capabilityName.replaceAll('.', '_');
}
