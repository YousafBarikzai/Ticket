import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The activity types a tenant starts with, at a rate of nothing and billable
 * to nobody.
 *
 * Rates are money and money is the tenant's to set; a seeded rate would be a
 * guess dressed as a default. Time is recorded from the first ticket; cost
 * appears the day a rate is entered, and only for entries logged after it.
 *
 * None of them is billable out of the box (OD-07), and that is the same
 * argument as the rate. The failure mode of this direction is under-billing,
 * which is a conversation somebody has; the failure mode of the other is
 * invoicing a customer for work nobody meant to charge for, which is a refund
 * and a lost argument about trust. An administrator marks the types their desk
 * actually charges for, once, in the console.
 */
export const DEFAULT_ACTIVITY_TYPES = [
  { key: 'work', name: 'Working the ticket', billable: false, isSystem: false },
  { key: 'investigation', name: 'Investigation', billable: false, isSystem: false },
  { key: 'communication', name: 'Communication', billable: false, isSystem: false },
  { key: 'travel', name: 'Travel', billable: false, isSystem: false },
  // The automatic kind is logged against this, and nobody can pick it by hand.
  { key: 'elapsed', name: 'Elapsed in a working state', billable: false, isSystem: true },
] as const;

export const AUTOMATIC_ACTIVITY_KEY = 'elapsed';

export async function seedTimeDefaults(ctx: TenantContext): Promise<{ created: number }> {
  return transaction(ctx, async (tx) => {
    let created = 0;
    for (const type of DEFAULT_ACTIVITY_TYPES) {
      const existing = await tx.activityType.findFirst({ where: { key: type.key } });
      if (existing) continue;
      await tx.activityType.create({
        data: { id: newId(), tenantId: ctx.tenantId, key: type.key, name: type.name, billable: type.billable, isSystem: type.isSystem },
      });
      created += 1;
    }
    return { created };
  });
}
