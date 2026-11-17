import { CapabilityError } from '@civic-ledger/core';
import type { DistrictShape } from '@/components/district-locator';
import type { Logger } from './api/logger';
import { safeErrorFields } from './api/logger';

/**
 * The locator map is an extra on a profile, never a reason to lose it. `districts.shape`
 * decides who gets a map (core checks the member is current and that a House district belongs
 * to the boundary Congress); `not_found` simply means "no map for this seat". Any other failure
 * (the table missing after a rollback, a query error, a timeout) is logged and the profile
 * renders without the map instead of failing.
 */
export async function loadMemberDistrictShape(
  slug: string,
  deps: {
    read: (name: 'districts.shape', input: { slug: string }) => Promise<DistrictShape>;
    logger: Logger;
  },
): Promise<DistrictShape | null> {
  try {
    return await deps.read('districts.shape', { slug });
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'not_found') return null;
    deps.logger.error(
      { event: 'web.district_map', outcome: 'unavailable', err: safeErrorFields(error) },
      'district map unavailable; rendering the profile without it',
    );
    return null;
  }
}
