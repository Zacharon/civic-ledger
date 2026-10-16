import { CapabilityError } from '@civic-ledger/core';
import type { z } from 'zod';

type Schema = z.core.JSONSchema.JSONSchema;

const MAX_PARAMS = 100;
const MAX_INDEX = 1_000;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const INTEGER = /^-?\d+$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const INDEX = /^\d+$/;

/** Name of the one reserved parameter that carries the whole input as JSON. */
export const INPUT_PARAM = 'input';

function invalid(path: string, message: string): CapabilityError {
  return new CapabilityError('invalid_input', 'Query string failed to parse', {
    issues: [{ path, message }],
  });
}

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null;
}

/** Every branch of a union (anyOf/oneOf/allOf) is searched; `type` may also be an array. */
function leafTypes(node: Schema): Set<string> {
  const types = new Set<string>();
  const visit = (n: Schema): void => {
    if (typeof n.type === 'string') types.add(n.type);
    else if (Array.isArray(n.type)) for (const t of n.type) types.add(t);
    for (const branch of [...(n.anyOf ?? []), ...(n.oneOf ?? []), ...(n.allOf ?? [])])
      visit(branch);
  };
  visit(node);
  return types;
}

function arrayItems(node: Schema): Schema | undefined {
  return isSchema(node.items) && !Array.isArray(node.items) ? node.items : undefined;
}

/** `a[b][0]` and `a.b.0` are the same path. */
function pathOf(key: string): string[] {
  return key.replaceAll(/\[([^\]]*)\]/g, '.$1').split('.');
}

function coerceScalar(value: string, node: Schema | undefined): unknown {
  if (!node) return value;
  const types = leafTypes(node);
  if (types.has('string')) return value;
  if (types.has('integer') && INTEGER.test(value)) return Number(value);
  if ((types.has('number') || types.has('integer')) && NUMBER.test(value)) return Number(value);
  if (types.has('boolean')) {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  // Wrong shape stays a string so validation reports the same message as for a JSON caller.
  return value;
}

function isArrayNode(node: Schema | undefined): boolean {
  return !!node && leafTypes(node).has('array');
}

/** One query key's values, coerced for the schema node it addresses. */
function coerceValues(values: string[], node: Schema | undefined, path: string): unknown {
  if (!node || !isArrayNode(node)) {
    if (values.length > 1) throw invalid(path, 'Parameter given more than once');
    return coerceScalar(values[0] ?? '', node);
  }
  const items = arrayItems(node);
  if (items && leafTypes(items).has('object')) {
    throw invalid(path, 'Use indexed keys (path.0.field=value) or input=<json> for this parameter');
  }
  // Repeated keys and comma-separated lists both build an array of scalars.
  return values.flatMap((v) => v.split(',')).map((v) => coerceScalar(v, items));
}

function childNode(node: Schema | undefined, segment: string): Schema | undefined {
  if (!node) return undefined;
  if (isArrayNode(node)) return arrayItems(node);
  const property =
    node.properties && Object.hasOwn(node.properties, segment)
      ? node.properties[segment]
      : undefined;
  return isSchema(property) ? property : undefined;
}

type Container = Record<string, unknown> | unknown[];

function assign(container: Container, segment: string, value: unknown): void {
  if (Array.isArray(container)) container[Number(segment)] = value;
  else container[segment] = value;
}

function existing(container: Container, segment: string): unknown {
  if (Array.isArray(container)) return container[Number(segment)];
  return Object.hasOwn(container, segment) ? container[segment] : undefined;
}

function validateSegments(segments: string[], key: string): void {
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment) || segment === '') {
      throw invalid(key, `Invalid parameter name "${key}"`);
    }
    if (INDEX.test(segment) && Number(segment) > MAX_INDEX) {
      throw invalid(key, `Array index must be at most ${MAX_INDEX}`);
    }
  }
}

/**
 * Turns a query string into the typed input a capability's zod schema expects, guided by the
 * schema's own JSON Schema (no per-capability code). Scalars are coerced by declared type;
 * objects use `filters.chamber=house` or `filters[chamber]=house`; arrays of scalars repeat the
 * key or use commas; arrays of objects use indices (`sort.0.column=state`). Unknown keys are kept
 * verbatim so strict validation rejects them exactly as it does for a JSON caller.
 * `input=<json>` supplies the whole input instead and cannot be combined with other parameters.
 */
export function coerceQuery(schema: Schema, params: URLSearchParams): unknown {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of params) grouped.set(key, [...(grouped.get(key) ?? []), value]);
  if (grouped.size > MAX_PARAMS) throw invalid('', `At most ${MAX_PARAMS} query parameters`);

  if (grouped.has(INPUT_PARAM)) {
    if (grouped.size > 1) {
      throw invalid(INPUT_PARAM, '"input" cannot be combined with other query parameters');
    }
    const raw = grouped.get(INPUT_PARAM)?.[0] ?? '';
    try {
      return JSON.parse(raw);
    } catch {
      throw invalid(INPUT_PARAM, '"input" must be valid JSON');
    }
  }

  const root: Record<string, unknown> = {};
  for (const [key, values] of grouped) {
    const segments = pathOf(key);
    validateSegments(segments, key);

    let container: Container = root;
    let node: Schema | undefined = schema;
    for (const [i, segment] of segments.entries()) {
      node = childNode(node, segment);
      if (i === segments.length - 1) {
        if (existing(container, segment) !== undefined) {
          throw invalid(key, 'Parameter given more than once');
        }
        assign(container, segment, coerceValues(values, node, key));
        break;
      }
      let next = existing(container, segment);
      if (next === undefined) {
        next = isArrayNode(node) ? [] : {};
        assign(container, segment, next);
      }
      if (typeof next !== 'object' || next === null)
        throw invalid(key, `Conflicting parameter "${key}"`);
      container = next as Container;
    }
  }
  return root;
}
