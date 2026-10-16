import {
  type Capability,
  type CapabilityContext,
  CapabilityError,
  dispatchByName,
  publicCapabilities,
} from '@civic-ledger/core';
import { z } from 'zod';
import { cacheControlFor, etagOf, matchesEtag } from './cache';
import { baseHeaders, CORS_PREFLIGHT_HEADERS, errorResponse, toCapabilityError } from './http';
import type { Logger } from './logger';
import { coerceQuery } from './query';
import { requestIdFrom } from './request-id';

/** Capabilities whose input is a document rather than a handful of scalars are POSTed as JSON. */
const POST_CAPABILITIES: ReadonlySet<string> = new Set(['frameworks.evaluate']);
export const MAX_BODY_BYTES = 256 * 1024;

const inputSchemas = new WeakMap<Capability, z.core.JSONSchema.JSONSchema>();

function inputJsonSchema(capability: Capability): z.core.JSONSchema.JSONSchema {
  let schema = inputSchemas.get(capability);
  if (!schema) {
    schema = z.toJSONSchema(capability.input, { io: 'input', unrepresentable: 'any' });
    inputSchemas.set(capability, schema);
  }
  return schema;
}

export function allowedMethodFor(capabilityName: string): 'GET' | 'POST' {
  return POST_CAPABILITIES.has(capabilityName) ? 'POST' : 'GET';
}

function invalidBody(message: string): CapabilityError {
  return new CapabilityError('invalid_input', message, { issues: [{ path: '', message }] });
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw invalidBody('Content-Type must be application/json');
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw invalidBody(`Body exceeds ${MAX_BODY_BYTES} bytes`);

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw invalidBody(`Body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalidBody('Body must be valid JSON');
  }
}

async function readInput(request: Request, capability: Capability): Promise<unknown> {
  if (allowedMethodFor(capability.name) === 'POST') return readJsonBody(request);
  return coerceQuery(inputJsonSchema(capability), new URL(request.url).searchParams);
}

export interface HandlerDeps {
  context: () => CapabilityContext | Promise<CapabilityContext>;
  logger: Logger;
}

export type CapabilityHandler = (request: Request, capabilityName: string) => Promise<Response>;

/**
 * The one `/api/v1/<capability>` handler. It resolves the name against the public registry
 * (operator capabilities do not exist here), turns the request into capability input, calls
 * `dispatchByName` and maps the result or CapabilityError to HTTP. Output is whatever the
 * capability's output schema let through.
 */
export function createCapabilityHandler({ context, logger }: HandlerDeps): CapabilityHandler {
  const publicByName = new Map(publicCapabilities().map((c) => [c.name, c]));

  async function respond(
    request: Request,
    capabilityName: string,
    requestId: string,
  ): Promise<Response> {
    const capability = publicByName.get(capabilityName);
    if (!capability)
      throw new CapabilityError('not_found', `Unknown capability "${capabilityName}"`);

    const allowed = allowedMethodFor(capability.name);
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (method !== allowed) {
      return errorResponse(
        new CapabilityError('invalid_input', `${capability.name} accepts ${allowed} only`),
        requestId,
        { allow: `${allowed}, OPTIONS` },
        405,
      );
    }

    const input = await readInput(request, capability);
    const result = await dispatchByName(capability.name, input, await context());

    const body = JSON.stringify(result);
    const headers = baseHeaders(requestId, { 'cache-control': cacheControlFor(capability.name) });
    if (allowed === 'GET') {
      const etag = etagOf(body);
      headers.set('etag', etag);
      if (matchesEtag(request.headers.get('if-none-match'), etag)) {
        headers.delete('content-type');
        return new Response(null, { status: 304, headers });
      }
    }
    return new Response(body, { status: 200, headers });
  }

  return async (request, capabilityName) => {
    const started = performance.now();
    const requestId = requestIdFrom(request.headers);
    let response: Response;
    let failure: CapabilityError | undefined;
    try {
      response = await respond(request, capabilityName, requestId);
    } catch (error) {
      failure = toCapabilityError(error);
      response = errorResponse(failure, requestId);
    }
    const fields = {
      requestId,
      capability: capabilityName,
      method: request.method,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    };
    if (failure?.code === 'internal') {
      logger.error({ ...fields, err: failure.cause ?? failure }, 'request failed');
    } else {
      logger.info(fields, 'request');
    }
    return response;
  };
}

export function preflightResponse(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_PREFLIGHT_HEADERS, 'x-request-id': requestId },
  });
}
