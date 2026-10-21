import { CapabilityError } from '@civic-ledger/core';
import { describe, expect, it, vi } from 'vitest';
import type { DistrictShape } from '../src/components/district-locator';
import { createLogger } from '../src/server/api/logger';
import { loadMemberDistrictShape } from '../src/server/district-map';

const shape = { state: 'ZV', scope: 'district' } as unknown as DistrictShape;

function logger() {
  const lines: string[] = [];
  const log = createLogger({
    level: 'info',
    destination: { write: (line: string) => void lines.push(line) },
  });
  return { log, lines };
}

describe('loadMemberDistrictShape (a map never takes a profile down)', () => {
  it('returns the capability output for the member', async () => {
    const read = vi.fn().mockResolvedValue(shape);
    const { log, lines } = logger();
    await expect(loadMemberDistrictShape('a-member', { read, logger: log })).resolves.toBe(shape);
    expect(read).toHaveBeenCalledWith('districts.shape', { slug: 'a-member' });
    expect(lines).toEqual([]);
  });

  it('renders nothing, without logging, when core says there is no map for this seat', async () => {
    const read = vi.fn().mockRejectedValue(new CapabilityError('not_found', 'former member'));
    const { log, lines } = logger();
    await expect(loadMemberDistrictShape('x', { read, logger: log })).resolves.toBeNull();
    expect(lines).toEqual([]);
  });

  it('logs and renders nothing for an internal error, a missing table or any thrown value', async () => {
    for (const failure of [
      new CapabilityError('internal', 'The data request could not be completed. Try again.'),
      Object.assign(new Error('relation "district_map" does not exist'), { code: '42P01' }),
      'a string',
    ]) {
      const read = vi.fn().mockRejectedValue(failure);
      const { log, lines } = logger();
      await expect(loadMemberDistrictShape('x', { read, logger: log })).resolves.toBeNull();
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] as string);
      expect(entry).toMatchObject({
        level: 'error',
        event: 'web.district_map',
        outcome: 'unavailable',
      });
      // The driver message (it can carry SQL or connection details) is never logged.
      expect(lines[0]).not.toContain('district_map" does not exist');
    }
  });
});
