/**
 * MCP stdio adapter. Registers exactly `publicCapabilities()` from @civic-ledger/core as
 * read-only tools, reuses their zod schemas and calls `dispatchByName`; operator
 * capabilities (ingest.run, curated.validate) are never exposed.
 */
export { toolNameFor } from './names';
export { DEFAULT_SESSION_LIMIT, SessionLimiter, type SessionLimiterOptions } from './rate-limit';
export {
  createMcpServer,
  errorBodyOf,
  type McpServerOptions,
  publicTools,
  SERVER_NAME,
  SERVER_VERSION,
} from './server';
