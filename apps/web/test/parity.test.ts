import { HTTP_STATUS_BY_ERROR, publicCapabilities } from '@civic-ledger/core';
import { refreshPersonCard } from '@civic-ledger/db';
import { toolNameFor } from '@civic-ledger/mcp';
import { beforeAll, describe, expect, it } from 'vitest';
import { plain, type Stack, seededStack, toolErrorBody } from './stack';

/**
 * Seven-gate evidence for the read capabilities (docs/AGENT_NATIVE_EVIDENCE.md):
 * direct dispatch, the HTTP handler and the MCP tool must return deep-equal business payloads
 * and identical errors from the same seeded database.
 */
const stack = seededStack();

type Cases = Record<string, Array<Record<string, unknown>>>;
let cases: Cases;
let slugs: string[];

beforeAll(async () => {
  const { direct } = stack();
  const people = (await direct('people.search', { limit: 100 })) as {
    items: Array<{ slug: string }>;
  };
  slugs = people.items.map((p) => p.slug);
  const [a, b, c] = slugs as [string, string, string];

  // A person who actually has promises, so the filter case is not vacuous.
  let withPromises = a;
  for (const slug of slugs) {
    const result = (await direct('promises.list', { slug })) as { summary: { total: number } };
    if (result.summary.total > 0) {
      withPromises = slug;
      break;
    }
  }
  const frameworks = (await direct('frameworks.list', {})) as {
    items: Array<{ spec: Record<string, unknown> }>;
  };
  const spec = frameworks.items[0]?.spec;
  if (!spec) throw new Error('Seed has no framework');

  cases = {
    'people.search': [
      {},
      { q: 'a', chamber: 'senate', limit: 5, offset: 1 },
      { state: 'ZY' },
      { party: 'Harbor Party', limit: 3 },
      { q: 'Oakhurst' },
      { scope: 'current', limit: 5 },
    ],
    'people.get': [{ slug: a }, { slug: b }, { slug: 'cornelius-oakhurst' }],
    'people.glance': [{ slug: a }, { slug: b }, { slug: 'cornelius-oakhurst' }],
    'explainers.list': [{}, { id: 'pac' }, { id: 'small-dollar' }],
    'people.compare': [
      { slugs: [a, b] },
      { slugs: [a, b, c] },
      { slugs: [a, 'philippa-wrenfield'] },
    ],
    'explore.table': [
      {},
      {
        filters: { chamber: 'house' },
        sort: [{ column: 'totalReceiptsCents', direction: 'desc' }, { column: 'sortName' }],
        limit: 10,
      },
      { filters: { state: 'ZV', q: 'a' }, limit: 5, offset: 2 },
      { filters: { scope: 'all' }, sort: [{ column: 'tenureYears', direction: 'desc' }] },
    ],
    'money.summary': [{ slug: a }, { slug: a, cycle: 2024 }],
    'votes.list': [
      { slug: a, limit: 5 },
      { policyArea: 'education', congress: 119, chamber: 'senate' },
      { limit: 3, offset: 1 },
    ],
    'scores.list': [{ slug: a }, { slug: c }],
    'promises.list': [{ slug: withPromises }, { slug: withPromises, status: 'kept' }],
    'policy.areas': [{}],
    'frameworks.list': [{}],
    'frameworks.evaluate': [
      { framework: spec, limit: 5 },
      { framework: spec, people: { chamber: 'senate' }, limit: 3, offset: 1 },
      { framework: spec, people: { slugs: [a, b] } },
    ],
    'sources.status': [{}],
    'explore.facets': [{}, { scope: 'all' }],
    'people.portrait': [{ slug: a }],
  };
});

const names = publicCapabilities().map((c) => c.name);
/** Binary capabilities are not JSON: see "binary capabilities" below. */
const jsonNames = publicCapabilities()
  .filter((c) => c.transport !== 'binary')
  .map((c) => c.name);

describe('read capabilities return equal payloads through dispatch, HTTP and MCP', () => {
  it('has representative inputs for every public capability', () => {
    expect(Object.keys(cases).sort()).toEqual([...names].sort());
  });

  it.each(jsonNames)('%s', async (name) => {
    const { direct, http, mcp } = stack();
    for (const input of cases[name] ?? []) {
      const expected = plain(await direct(name, input));

      const response = await http(name, input);
      expect(response.status, `${name} ${JSON.stringify(input)} over HTTP`).toBe(200);
      expect(await response.json()).toEqual(expected);

      const tool = await mcp(name, input);
      expect(tool.isError, `${name} ${JSON.stringify(input)} over MCP`).not.toBe(true);
      expect(tool.structuredContent).toEqual(expected);
      // The text block carries the same payload for clients that ignore structuredContent.
      const text = (tool.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(JSON.parse(text)).toEqual(expected);
    }
  });
});

describe('binary capabilities return the same file through dispatch, HTTP and MCP', () => {
  async function portraitSlugs(): Promise<{ withPortrait: string; without: string }> {
    const { direct } = stack();
    let withPortrait: string | undefined;
    let without: string | undefined;
    for (const slug of slugs) {
      const { portrait } = (await direct('people.get', { slug })) as { portrait: unknown };
      if (portrait && !withPortrait) withPortrait = slug;
      if (!portrait && !without) without = slug;
    }
    if (!withPortrait || !without)
      throw new Error('seed needs members with and without a portrait');
    return { withPortrait, without };
  }

  it.each([225, 450])(
    'people.portrait at %i px is byte-identical in every adapter',
    async (size) => {
      const { direct, http, mcp } = stack();
      const { withPortrait } = await portraitSlugs();
      const input = { slug: withPortrait, size };
      const expected = (await direct('people.portrait', input)) as {
        bytes: Uint8Array;
        sha256: string;
      };
      const { bytes, ...metadata } = expected;

      const response = await http('people.portrait', input);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(response.headers.get('etag')).toBe(`"${expected.sha256}"`);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);

      const tool = await mcp('people.portrait', input);
      expect(tool.isError).not.toBe(true);
      expect(tool.structuredContent).toEqual(plain(metadata));
      const blocks = tool.content as Array<{
        type: string;
        data?: string;
        mimeType?: string;
        text?: string;
      }>;
      expect(JSON.parse(blocks.find((b) => b.type === 'text')?.text ?? 'null')).toEqual(
        plain(metadata),
      );
      const image = blocks.find((b) => b.type === 'image');
      expect(image?.mimeType).toBe('image/jpeg');
      expect(Buffer.from(image?.data ?? '', 'base64').equals(Buffer.from(bytes))).toBe(true);
    },
  );

  it('people.get states the same file facts that people.portrait serves', async () => {
    const { direct, http, mcp } = stack();
    const { withPortrait } = await portraitSlugs();
    const profile = plain(await direct('people.get', { slug: withPortrait })) as {
      portrait: { variants: Array<{ size: 225 | 450; sha256: string; url: string }> };
    };
    for (const variant of profile.portrait.variants) {
      const file = (await direct('people.portrait', {
        slug: withPortrait,
        size: variant.size,
      })) as { sha256: string };
      expect(variant.sha256).toBe(file.sha256);
      expect(variant.url).toContain(`size=${variant.size}&v=${file.sha256.slice(0, 12)}`);
    }
    expect(await (await http('people.get', { slug: withPortrait })).json()).toEqual(profile);
    expect((await mcp('people.get', { slug: withPortrait })).structuredContent).toEqual(profile);
  });

  it('people.get says portrait is null (not absent) for a member without one', async () => {
    const { direct, http, mcp } = stack();
    const { without } = await portraitSlugs();
    const profile = plain(await direct('people.get', { slug: without })) as { portrait: unknown };
    expect(profile.portrait).toBeNull();
    const overHttp = (await (await http('people.get', { slug: without })).json()) as {
      portrait: unknown;
    };
    expect(overHttp.portrait).toBeNull();
    expect((await mcp('people.get', { slug: without })).structuredContent).toEqual(profile);
  });
});

const INVALID: Array<[string, Record<string, unknown>, 'invalid_input' | 'not_found']> = [
  ['people.search', { limt: 5 }, 'invalid_input'],
  ['people.search', { limit: 0 }, 'invalid_input'],
  ['people.search', { limit: 'many' }, 'invalid_input'],
  ['people.search', { chamber: 'lords' }, 'invalid_input'],
  ['people.search', { state: 'zy' }, 'invalid_input'],
  ['people.get', {}, 'invalid_input'],
  ['people.glance', {}, 'invalid_input'],
  ['people.glance', { slug: 'nobody-by-this-name' }, 'not_found'],
  ['explainers.list', { id: 'No Spaces' }, 'invalid_input'],
  ['explainers.list', { id: 'unknown-term' }, 'not_found'],
  ['people.get', { slug: 'Not A Slug' }, 'invalid_input'],
  ['people.get', { slug: 'nobody-by-this-name' }, 'not_found'],
  ['people.compare', { slugs: ['only-one'] }, 'invalid_input'],
  ['explore.table', { sort: [{ column: 'ideology' }] }, 'invalid_input'],
  ['explore.table', { filters: { chamber: 'lords' } }, 'invalid_input'],
  ['explore.table', { filters: { nope: 1 } }, 'invalid_input'],
  ['explore.table', { filters: { scope: 'former' } }, 'invalid_input'],
  ['explore.facets', { scope: 'everyone' }, 'invalid_input'],
  ['money.summary', { slug: 'a-slug', cycle: 1800 }, 'invalid_input'],
  ['votes.list', { congress: 'x' }, 'invalid_input'],
  ['scores.list', { slug: 'nobody-by-this-name' }, 'not_found'],
  ['promises.list', { slug: 'x', status: 'maybe' }, 'invalid_input'],
  ['policy.areas', { anything: 1 }, 'invalid_input'],
  ['frameworks.evaluate', { framework: { title: '', rules: [] } }, 'invalid_input'],
  ['frameworks.evaluate', { framework: { title: 'x', rules: [{ bogus: true }] } }, 'invalid_input'],
  ['sources.status', { verbose: true }, 'invalid_input'],
  ['people.portrait', {}, 'invalid_input'],
  ['people.portrait', { slug: 'nobody-by-this-name' }, 'not_found'],
  ['people.portrait', { slug: 'someone', size: 300 }, 'invalid_input'],
  ['people.portrait', { slug: 'someone', v: 'NOT-HEX' }, 'invalid_input'],
];

describe('the same invalid input fails the same way through dispatch, HTTP and MCP', () => {
  it.each(INVALID)('%s %j -> %s', async (name, input, code) => {
    const { direct, http, mcp } = stack();
    const expected = await direct(name, input).then(
      () => {
        throw new Error('expected the direct call to fail');
      },
      (error: { toBody(): unknown; code: string }) => ({ code: error.code, body: error.toBody() }),
    );
    expect(expected.code).toBe(code);

    const response = await http(name, input);
    expect(response.status).toBe(HTTP_STATUS_BY_ERROR[code]);
    expect(await response.json()).toEqual(expected.body);

    const tool = await mcp(name, input);
    expect(tool.isError).toBe(true);
    expect(toolErrorBody(tool)).toEqual(expected.body);
  });
});

describe('operator-only capabilities are unreachable', () => {
  it('lists exactly the public capabilities as MCP tools, read-only', async () => {
    const { client } = stack();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(names.map(toolNameFor).sort());
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
    expect(tools.map((t) => t.name)).not.toContain('curated_validate');
    expect(tools.map((t) => t.name)).not.toContain('ingest_run');
  });

  it.each(['curated.validate', 'ingest.run', 'people.delete'])(
    '%s is 404 over HTTP (GET and POST) and an unknown tool over MCP',
    async (name) => {
      const { http, mcp } = stack();
      for (const init of [{ method: 'GET' }, { method: 'POST', body: '{}' }]) {
        const response = await http(name, {}, init);
        expect(response.status).toBe(404);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
          'not_found',
        );
      }
      const tool = await mcp(name, { files: [{ path: 'a.yaml', content: 'x' }] });
      expect(tool.isError).toBe(true);
      expect(toolErrorBody(tool).error.code).toBe('not_found');
    },
  );
});

describe('both adapters see state changed after a refresh', () => {
  let s: Stack;
  beforeAll(() => {
    s = stack();
  });

  it('shows a renamed person and a new read-model refresh time in dispatch, HTTP and MCP', async () => {
    const slug = slugs[0] as string;
    const before = plain(await s.direct('sources.status', {})) as { readModelRefreshedAt: string };

    if (s.handle.kind !== 'pglite') throw new Error('test database is PGlite');
    await s.handle.client.query('update person set full_name = $1 where slug = $2', [
      'Renamed After Refresh',
      slug,
    ]);
    await refreshPersonCard(s.ctx.db);

    const lookup = { q: 'Renamed After Refresh' };
    const direct = plain(await s.direct('people.search', lookup)) as {
      items: Array<{ slug: string; fullName: string }>;
    };
    expect(direct.items.map((i) => i.slug)).toEqual([slug]);

    expect(await (await s.http('people.search', lookup)).json()).toEqual(direct);
    expect((await s.mcp('people.search', lookup)).structuredContent).toEqual(direct);

    const after = plain(await s.direct('sources.status', {})) as { readModelRefreshedAt: string };
    expect(Date.parse(after.readModelRefreshedAt)).toBeGreaterThan(
      Date.parse(before.readModelRefreshedAt),
    );
    expect(await (await s.http('sources.status', {})).json()).toEqual(after);
    expect((await s.mcp('sources.status', {})).structuredContent).toEqual(after);
  });
});
