import { publicCapabilities } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { toolNameFor } from '../src';

describe('MCP tool names', () => {
  it('maps every public capability to the CAPABILITIES.md tool name', () => {
    const names = publicCapabilities().map((c) => toolNameFor(c.name));
    expect(names).toContain('people_search');
    expect(names).toContain('frameworks_evaluate');
    expect(names.every((n) => /^[a-z]+_[a-z]+$/.test(n))).toBe(true);
    expect(names).not.toContain('curated_validate');
  });
});
