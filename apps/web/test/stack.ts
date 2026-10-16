import {
  type CapabilityContext,
  type CapabilityName,
  createDb,
  type DbHandle,
  dispatchByName,
  type ErrorBody,
} from '@civic-ledger/core';
import { runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import { createMcpServer, toolNameFor } from '@civic-ledger/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll } from 'vitest';
import { createCapabilityHandler } from '../src/server/api/handler';
import { createLogger } from '../src/server/api/logger';

export const ORIGIN = 'http://civic-ledger.test';

/** The inverse of `coerceQuery`: encode a typed input as the query string a client would send. */
export function toQuery(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      const scalars = value.every((v) => typeof v !== 'object' || v === null);
      if (scalars) for (const v of value) params.append(path, String(v));
      else for (const [i, v] of value.entries()) walk(v, `${path}.${i}`);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, v] of Object.entries(value)) walk(v, path ? `${path}.${key}` : key);
    } else {
      params.append(path, String(value));
    }
  };
  walk(input, '');
  return params.toString();
}

export interface Stack {
  handle: DbHandle;
  ctx: CapabilityContext;
  client: Client;
  /** Direct core call (the contract every adapter must match). */
  direct(name: string, input: unknown): Promise<unknown>;
  /** The `/api/v1` handler: GET with a query string, or POST with JSON for frameworks.evaluate. */
  http(name: string, input: Record<string, unknown>, init?: RequestInit): Promise<Response>;
  /** The MCP tool call, returning the raw tool result. */
  mcp(name: string, input: Record<string, unknown>): ReturnType<Client['callTool']>;
}

export const POST_ONLY = new Set<string>(['frameworks.evaluate']);

/** Boots an in-memory seeded PGlite plus an HTTP handler and an in-process MCP client/server pair. */
export function seededStack(): () => Stack {
  let stack: Stack | undefined;
  const closers: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const handle = createDb({ kind: 'pglite' });
    await runMigrations(handle);
    await seedDevData(handle.db);
    const ctx: CapabilityContext = { db: handle.db };

    const handler = createCapabilityHandler({
      context: () => ctx,
      logger: createLogger({ level: 'silent' }),
    });
    const server = createMcpServer({
      ctx,
      rateLimit: { capacity: 100_000, refillPerSecond: 1_000 },
    });
    const client = new Client({ name: 'parity-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(
      () => client.close(),
      () => server.close(),
      () => handle.close(),
    );

    stack = {
      handle,
      ctx,
      client,
      direct: (name, input) => dispatchByName(name, input, ctx),
      http: (name, input, init) => {
        const post = POST_ONLY.has(name);
        const url = `${ORIGIN}/api/v1/${name}${post || Object.keys(input).length === 0 ? '' : `?${toQuery(input)}`}`;
        return handler(
          new Request(
            url,
            post
              ? {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(input),
                  ...init,
                }
              : { method: 'GET', ...init },
          ),
          name,
        );
      },
      mcp: (name, input) => client.callTool({ name: toolNameFor(name), arguments: input }),
    };
  });

  afterAll(async () => {
    for (const close of closers.reverse()) await close();
  });

  return () => {
    if (!stack) throw new Error('Stack not ready');
    return stack;
  };
}

export type { CapabilityName, ErrorBody };

/** Text of the first content block, parsed as JSON. */
export function toolErrorBody(result: Awaited<ReturnType<Stack['mcp']>>): ErrorBody {
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  return JSON.parse(first?.text ?? 'null') as ErrorBody;
}

/** JSON round trip, so `undefined`-valued keys do not make equal payloads look different. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A database whose connection is already closed: every query fails (simulates an outage). */
export async function closedDb(): Promise<DbHandle> {
  const handle = createDb({ kind: 'pglite' });
  if (handle.kind === 'pglite') await handle.client.waitReady;
  await handle.close();
  return handle;
}
