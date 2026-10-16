import { billPolicyArea, policyArea, rollcallBill } from '@civic-ledger/db';
import { asc, countDistinct, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '../capability';
import { EmptyInputSchema } from '../schemas/common';

export const PolicyAreasOutput = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string().describe('Congress.gov policy-area name'),
      billCount: z.int(),
      rollcallCount: z.int(),
    }),
  ),
});

export const policyAreas = defineCapability({
  name: 'policy.areas',
  version: 1,
  kind: 'read',
  audience: 'public',
  summary: 'Congress.gov policy areas (the neutral topic base) with bill and rollcall counts.',
  input: EmptyInputSchema,
  output: PolicyAreasOutput,
  async handler({ db }) {
    const items = await db
      .select({
        id: policyArea.id,
        name: policyArea.name,
        billCount: countDistinct(billPolicyArea.billId),
        rollcallCount: countDistinct(rollcallBill.rollcallId),
      })
      .from(policyArea)
      .leftJoin(billPolicyArea, eq(billPolicyArea.policyAreaId, policyArea.id))
      .leftJoin(rollcallBill, eq(rollcallBill.billId, billPolicyArea.billId))
      .groupBy(policyArea.id, policyArea.name)
      .orderBy(asc(policyArea.name));
    return { items };
  },
});
