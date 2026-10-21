import { DistrictLocator } from '@/components/district-locator';
import { apiLogger } from '@/server/api/runtime';
import { read } from '@/server/capabilities';
import { loadMemberDistrictShape } from '@/server/district-map';

/**
 * The locator map for a member's seat. Who gets one is decided in core
 * (`districts.shape@1` with the member's slug); a seat without a map shows nothing, and a
 * failure is logged without taking the profile down (see `loadMemberDistrictShape`).
 */
export async function MemberDistrictMap({ slug }: { slug: string }) {
  const shape = await loadMemberDistrictShape(slug, { read, logger: apiLogger() });
  return shape ? <DistrictLocator shape={shape} /> : null;
}
