import { publicCapabilities, registry } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/server/api/openapi';

interface Operation {
  operationId: string;
  parameters?: Array<{ name: string; in: string; required: boolean; style?: string }>;
  requestBody?: { content: Record<string, { schema: { type: string } }> };
  responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
}
interface Document {
  openapi: string;
  paths: Record<string, { get?: Operation; post?: Operation }>;
  components: { schemas: { ErrorBody: { properties: { error: unknown } } } };
}

const doc = buildOpenApiDocument() as unknown as Document;

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1', () => {
    expect(doc.openapi).toBe('3.1.0');
  });

  it('documents every public capability and no operator-only one', () => {
    const documented = Object.keys(doc.paths)
      .filter((p) => p.startsWith('/api/v1/'))
      .map((p) => p.replace('/api/v1/', ''))
      .sort();
    expect(documented).toEqual(
      publicCapabilities()
        .map((c) => c.name)
        .sort(),
    );

    const operatorOnly = Object.values(registry).filter((c) => c.audience === 'operator');
    expect(operatorOnly.length).toBeGreaterThan(0);
    for (const capability of operatorOnly) {
      expect(doc.paths[`/api/v1/${capability.name}`]).toBeUndefined();
    }
    expect(JSON.stringify(doc)).not.toContain('curated.validate');
    expect(JSON.stringify(doc)).not.toContain('ingest.run');
  });

  it('uses GET with query parameters for reads and POST with a JSON body for evaluate', () => {
    expect(doc.paths['/api/v1/people.search']?.get?.parameters?.map((p) => p.name)).toEqual([
      'q',
      'scope',
      'chamber',
      'state',
      'party',
      'limit',
      'offset',
      'input',
    ]);
    const filters = doc.paths['/api/v1/explore.table']?.get?.parameters?.find(
      (p) => p.name === 'filters',
    );
    expect(filters?.style).toBe('deepObject');
    expect(doc.paths['/api/v1/frameworks.evaluate']?.get).toBeUndefined();
    expect(
      doc.paths['/api/v1/frameworks.evaluate']?.post?.requestBody?.content['application/json']
        ?.schema.type,
    ).toBe('object');
  });

  it('describes the output schema and the shared error body for each operation', () => {
    for (const capability of publicCapabilities()) {
      const path = doc.paths[`/api/v1/${capability.name}`];
      const operation = path?.get ?? path?.post;
      expect(operation?.operationId, capability.name).toBe(capability.name.replaceAll('.', '_'));
      expect(operation?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
      for (const status of ['400', '404', '429', '500']) {
        expect(operation?.responses[status], `${capability.name} ${status}`).toBeDefined();
      }
    }
    expect(doc.components.schemas.ErrorBody.properties.error).toBeDefined();
  });

  it('has no unresolved references', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(refs)).toEqual(new Set(['#/components/schemas/ErrorBody']));
  });
});
