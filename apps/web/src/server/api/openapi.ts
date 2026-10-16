import { ERROR_CODES, ErrorBodySchema, publicCapabilities } from '@civic-ledger/core';
import { z } from 'zod';
import { allowedMethodFor } from './handler';
import { INPUT_PARAM } from './query';

type Schema = z.core.JSONSchema.JSONSchema;
type Json = Record<string, unknown>;

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

function schemaOf(schema: z.ZodType, io: 'input' | 'output'): Schema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any' });
  return rest;
}

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null;
}

/** Top-level input properties become query parameters; the encodings match `query.ts`. */
function queryParameters(input: Schema): Json[] {
  const required = new Set(input.required ?? []);
  const parameters: Json[] = Object.entries(input.properties ?? {})
    .filter((entry): entry is [string, Schema] => isSchema(entry[1]))
    .map(([name, schema]) => {
      const { description, ...rest } = schema;
      return {
        name,
        in: 'query',
        required: required.has(name),
        ...(description ? { description } : {}),
        schema: rest,
        ...(schema.type === 'object' ? { style: 'deepObject', explode: true } : {}),
        ...(schema.type === 'array' ? { style: 'form', explode: true } : {}),
      };
    });
  parameters.push({
    name: INPUT_PARAM,
    in: 'query',
    required: false,
    description:
      'The whole input as one JSON object; cannot be combined with other query parameters. ' +
      'Use it for arrays of objects such as the explore.table sort (or indexed keys: sort.0.column=state).',
    content: { 'application/json': { schema: { type: 'object' } } },
  });
  return parameters;
}

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
});

const OPERATION_HEADERS = {
  'X-Request-Id': {
    description: 'Echo of the caller id or a generated one',
    schema: { type: 'string' },
  },
  ETag: { description: 'Validator for If-None-Match (GET only)', schema: { type: 'string' } },
  'Cache-Control': { schema: { type: 'string' } },
};

/** OpenAPI 3.1 document generated from the registry's public capabilities. */
export function buildOpenApiDocument(): Json {
  const paths: Record<string, Json> = {};
  for (const capability of publicCapabilities()) {
    const input = schemaOf(capability.input, 'input');
    const output = schemaOf(capability.output, 'output');
    const method = allowedMethodFor(capability.name);
    const base = {
      operationId: capability.name.replaceAll('.', '_'),
      summary: capability.summary,
      tags: [capability.name.split('.')[0]],
      'x-capability': `${capability.name}@${capability.version}`,
      responses: {
        '200': {
          description: 'Capability output',
          headers: OPERATION_HEADERS,
          content: { 'application/json': { schema: output } },
        },
        ...(method === 'GET'
          ? { '304': { description: 'Not modified (If-None-Match matched)' } }
          : {}),
        '400': errorResponse('invalid_input: the input failed validation'),
        '404': errorResponse('not_found: unknown capability or no such record'),
        '429': errorResponse('rate_limited: see Retry-After'),
        '500': errorResponse('internal'),
      },
    };
    paths[`/api/v1/${capability.name}`] =
      method === 'GET'
        ? { get: { ...base, parameters: queryParameters(input) } }
        : {
            post: {
              ...base,
              requestBody: {
                required: true,
                content: { 'application/json': { schema: input } },
              },
            },
          };
  }

  paths['/api/health'] = {
    get: {
      operationId: 'health',
      summary: 'Database round trip and ingest freshness per source. Never cached.',
      parameters: [
        {
          name: 'strict',
          in: 'query',
          required: false,
          description: '1 = answer 503 when any source is stale or has never succeeded',
          schema: { type: 'string', enum: ['1'] },
        },
      ],
      responses: {
        '200': { description: 'ok or degraded' },
        '503': { description: 'database down (or degraded with strict=1)' },
      },
    },
  };

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: 'Civic Ledger public API',
      version: '1',
      description:
        'Read-only, credential-free JSON API over the same capabilities as the web UI and the MCP server. ' +
        'Money is integer US cents, shares are fractions in [0, 1], null means no data. ' +
        'Inputs are strict: unknown parameters are rejected with 400.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas: { ErrorBody: schemaOf(ErrorBodySchema, 'output') },
    },
    'x-error-codes': [...ERROR_CODES],
  };
}
