import {
  type Capability,
  type CapabilityContext,
  CapabilityError,
  dispatchByName,
  publicCapabilities,
} from '@civic-ledger/core';
import { z } from 'zod';
import { BodyDeadlineError, bodyReadTimeoutMs, readJsonBody } from './body';
import { cacheControlFor, etagOf, matchesEtag } from './cache';
import { baseHeaders, CORS_PREFLIGHT_HEADERS, errorResponse, toCapabilityError } from './http';
import type { Logger } from './logger';
import { coerceQuery } from './query';
import { requestIdFrom } from './request-id';

/** Capabilities whose input is a document rather than a handful of scalars are POSTed as JSON. */
const POST_CAPABILITIES: ReadonlySet<string> = new Set(['frameworks.evaluate']);

export { MAX_BODY_BYTES } from './body';

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

async function readInput(
  request: Request,
  capability: Capability,
  timeoutMs: number,
): Promise<unknown> {
  if (allowedMethodFor(capability.name) === 'POST') return readJsonBody(request, timeoutMs);
  return coerceQuery(inputJsonSchema(capability), new URL(request.url).searchParams);
}

export interface HandlerDeps {
  context: () => CapabilityContext | Promise<CapabilityContext>;
  logger: Logger;
  bodyReadTimeoutMs?: number;
}

export type CapabilityHandler = (request: Request, capabilityName: string) => Promise<Response>;

/**
 * The one `/api/v1/<capability>` handler. It resolves the name against the public registry
 * (operator capabilities do not exist here), turns the request into capability input, calls
 * `dispatchByName` and maps the result or CapabilityError to HTTP. Output is whatever the
 * capability's output schema let through.
 */
export function createCapabilityHandler({
  context,
  logger,
  bodyReadTimeoutMs: timeout,
}: HandlerDeps): CapabilityHandler {
  const timeoutMs = timeout ?? bodyReadTimeoutMs();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid body deadline');
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

    const input = await readInput(request, capability, timeoutMs);
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
      response = errorResponse(
        failure,
        requestId,
        {},
        error instanceof BodyDeadlineError ? 408 : undefined,
      );
    }
    const fields = {
      requestId,
      capability: publicByName.has(capabilityName) ? capabilityName : 'unknown',
      method: request.method,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    };
    try {
      if (failure?.code === 'internal') {
        logger.error({ ...fields, err: failure.cause ?? failure }, 'request failed');
      } else {
        logger.info(fields, 'request');
      }
    } catch {
      // Keep the HTTP outcome if the diagnostic sink fails; never dump a raw fallback.
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
