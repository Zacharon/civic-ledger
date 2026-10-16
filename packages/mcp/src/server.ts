import {
  type CapabilityContext,
  CapabilityError,
  dispatchByName,
  type ErrorBody,
  publicCapabilities,
} from '@civic-ledger/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolNameFor } from './names';
import { DEFAULT_SESSION_LIMIT, SessionLimiter, type SessionLimiterOptions } from './rate-limit';

export const SERVER_NAME = 'civic-ledger';
export const SERVER_VERSION = '0.0.0';

const INSTRUCTIONS = [
  'Civic Ledger: public money, votes, third-party scores, promises and platforms for U.S. officeholders.',
  'All tools are read-only. Money is integer US cents; shares and rates are fractions in [0, 1]; null means no data, never zero.',
  'Every fact carries provenance (sourceId, sourceKey, retrievedAt); resolve sourceId with sources_status.',
  'Scores are attributed to a named publisher or framework and are never a default sort.',
  'Errors are tool errors whose text is JSON: {"error":{"code","message","issues"?}}.',
].join('\n');

interface PublicTool {
  capabilityName: string;
  definition: Tool;
}

type JsonSchema = z.core.JSONSchema.JSONSchema;

function objectSchema(schema: JsonSchema, label: string): Tool['inputSchema'] {
  if (schema.type !== 'object') throw new Error(`${label} must be a JSON object schema`);
  const { properties, required, ...rest } = schema;
  return {
    ...rest,
    type: 'object',
    ...(properties ? { properties: properties as Record<string, object> } : {}),
    ...(required ? { required } : {}),
  };
}

/** One tool per public capability; schemas are generated from the capability's own zod schemas. */
export function publicTools(): PublicTool[] {
  return publicCapabilities().map((capability) => {
    const name = toolNameFor(capability.name);
    return {
      capabilityName: capability.name,
      definition: {
        name,
        title: capability.name,
        description: capability.summary,
        inputSchema: objectSchema(
          z.toJSONSchema(capability.input, { io: 'input', unrepresentable: 'any' }),
          `${name} input`,
        ),
        outputSchema: objectSchema(
          z.toJSONSchema(capability.output, { io: 'output', unrepresentable: 'any' }),
          `${name} output`,
        ),
        annotations: {
          title: capability.name,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    };
  });
}

/** Same wire format as the HTTP adapter's error body; internal details never leave the process. */
export function errorBodyOf(error: unknown): ErrorBody {
  if (error instanceof CapabilityError) return error.toBody();
  return { error: { code: 'internal', message: 'Internal error' } };
}

function toolError(body: ErrorBody): CallToolResult {
  // No structuredContent: an error does not match the tool's output schema.
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

export interface McpServerOptions {
  ctx: CapabilityContext;
  rateLimit?: SessionLimiterOptions;
  /** Receives the real cause of every `internal` error; it is never sent to the client. */
  onError?: (cause: unknown, tool: string) => void;
}

/** MCP adapter over the capability registry. Its only state is the session rate limiter. */
export function createMcpServer({ ctx, rateLimit, onError }: McpServerOptions): Server {
  const tools = publicTools();
  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  const limiter = new SessionLimiter(rateLimit ?? DEFAULT_SESSION_LIMIT);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return toolError(
        new CapabilityError('not_found', `Unknown tool "${request.params.name}"`).toBody(),
      );
    }
    const limit = limiter.take();
    if (!limit.allowed) {
      return toolError(
        new CapabilityError('rate_limited', 'Too many tool calls in this session', {
          retryAfterSeconds: limit.retryAfterSeconds,
        }).toBody(),
      );
    }
    try {
      const result = await dispatchByName(tool.capabilityName, request.params.arguments ?? {}, ctx);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      if (!(error instanceof CapabilityError)) onError?.(error, request.params.name);
      else if (error.code === 'internal') onError?.(error.cause ?? error, request.params.name);
      return toolError(errorBodyOf(error));
    }
  });

  return server;
}
