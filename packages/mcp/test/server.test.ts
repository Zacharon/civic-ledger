import { createDb, type DbHandle, publicCapabilities } from '@civic-ledger/core';
import { runMigrations } from '@civic-ledger/db/migrate';
import { seedDevData } from '@civic-ledger/db/seed';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createMcpServer,
  type McpServerOptions,
  publicTools,
  SessionLimiter,
  toolNameFor,
} from '../src';

const closers: Array<() => Promise<void>> = [];
let shared: DbHandle;

beforeAll(async () => {
  shared = createDb({ kind: 'pglite' });
  await runMigrations(shared);
  await seedDevData(shared.db);
});

afterAll(() => shared.close());

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
});

/** A fresh server/client pair per test over the shared seeded database (or a given one). */
async function connect(options: Partial<McpServerOptions> = {}, handle: DbHandle = shared) {
  const server = createMcpServer({ ctx: { db: handle.db }, ...options });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(
    () => client.close(),
    () => server.close(),
  );
  return client;
}

describe('tool catalog', () => {
  it('has one read-only tool per public capability with generated schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(publicCapabilities().length);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+_[a-z]+$/);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    const search = tools.find((t) => t.name === 'people_search');
    expect(Object.keys(search?.inputSchema.properties ?? {})).toEqual([
      'q',
      'scope',
      'chamber',
      'state',
      'party',
      'limit',
      'offset',
    ]);
    expect(search?.inputSchema).toMatchObject({ additionalProperties: false });
  });

  it('maps tool names to capabilities', () => {
    expect(publicTools().map((t) => t.definition.name)).toEqual(
      publicCapabilities().map((c) => toolNameFor(c.name)),
    );
  });

  it('exposes no operator capability', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('curated_validate');
    expect(names).not.toContain('ingest_run');
  });
});

describe('tool calls', () => {
  it('returns structured JSON plus the same JSON as text', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'policy_areas', arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? 'null');
    expect(result.structuredContent).toEqual(text);
    expect(Object.keys(text)).toEqual(['items']);
  });

  it('accepts missing arguments for tools without inputs', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'sources_status' });
    expect(result.isError).not.toBe(true);
  });

  it('returns validation failures as tool errors with dotted issue paths', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'people_search',
      arguments: { limit: 0, nope: 1 },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? 'null');
    expect(body.error.code).toBe('invalid_input');
    expect(body.error.issues.map((i: { path: string }) => i.path).sort()).toEqual(['', 'limit']);
  });

  it('hides internal failures from the client and reports the cause to the operator log', async () => {
    const causes: unknown[] = [];
    const broken = createDb({ kind: 'pglite' });
    if (broken.kind === 'pglite') await broken.client.waitReady;
    await broken.close();
    const client = await connect({ onError: (cause) => causes.push(cause) }, broken);
    const result = await client.callTool({ name: 'policy_areas', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? 'null')).toEqual({
      error: { code: 'internal', message: 'policy.areas failed' },
    });
    expect(causes).toHaveLength(1);
  });
});

describe('session rate limit', () => {
  it('refuses calls beyond the burst with rate_limited and a retry hint', async () => {
    const client = await connect({ rateLimit: { capacity: 2, refillPerSecond: 0.01 } });
    for (let i = 0; i < 2; i++) {
      expect((await client.callTool({ name: 'policy_areas', arguments: {} })).isError).not.toBe(
        true,
      );
    }
    const limited = await client.callTool({ name: 'policy_areas', arguments: {} });
    expect(limited.isError).toBe(true);
    const body = JSON.parse((limited.content as Array<{ text: string }>)[0]?.text ?? 'null');
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('refills over time', () => {
    let now = 0;
    const limiter = new SessionLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });
    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take()).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now = 1_000;
    expect(limiter.take()).toEqual({ allowed: true });
  });
});
