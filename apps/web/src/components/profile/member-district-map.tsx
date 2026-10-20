import { CapabilityError } from '@civic-ledger/core';
import { DistrictLocator } from '@/components/district-locator';
import { read } from '@/server/capabilities';

/**
 * The locator map for a member's seat, from `districts.shape@1`. Shown for current members
 * only: the boundary file describes the districts of the Congress now sitting, and a former
 * member's district number may have meant a different area. A seat without a map (a
 * territory the file does not draw, or no boundary data loaded) shows nothing.
 */
export async function MemberDistrictMap({
  state,
  chamber,
  district,
  isCurrent,
}: {
  state: string | null;
  chamber: 'house' | 'senate' | null;
  district: number | null;
  isCurrent: boolean;
}) {
  if (!isCurrent || !state || !chamber) return null;
  try {
    const shape = await read(
      'districts.shape',
      chamber === 'house' ? { state, district: district ?? 0 } : { state },
    );
    return <DistrictLocator shape={shape} />;
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'not_found') return null;
    throw error;
  }
}
