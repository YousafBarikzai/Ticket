import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The default P1–P4 policy from specification §11.2, plus the impact/urgency
 * matrix from §11.3 and a UK office calendar.
 *
 * Shipped as the tenant default so a new tenant has working SLAs on day one;
 * administrators change targets per service without touching code.
 */

export const OFFICE_HOURS = {
  mon: [{ start: '09:00', end: '17:30' }],
  tue: [{ start: '09:00', end: '17:30' }],
  wed: [{ start: '09:00', end: '17:30' }],
  thu: [{ start: '09:00', end: '17:30' }],
  fri: [{ start: '09:00', end: '17:00' }],
};

/** Response, update and resolution targets in minutes, per §11.2. */
export const DEFAULT_TARGETS = [
  { priority: 'P1', response: 15, update: 30, resolution: 240 },
  { priority: 'P2', response: 60, update: 240, resolution: 480 },
  { priority: 'P3', response: 240, update: 480, resolution: 1440 },
  { priority: 'P4', response: 480, update: 1440, resolution: 2400 },
];

/** Impact against urgency, per §11.3. */
export const PRIORITY_MATRIX = [
  { impact: 'high', urgency: 'high', priority: 'P1' },
  { impact: 'high', urgency: 'medium', priority: 'P2' },
  { impact: 'high', urgency: 'low', priority: 'P3' },
  { impact: 'medium', urgency: 'high', priority: 'P2' },
  { impact: 'medium', urgency: 'medium', priority: 'P3' },
  { impact: 'medium', urgency: 'low', priority: 'P3' },
  { impact: 'low', urgency: 'high', priority: 'P3' },
  { impact: 'low', urgency: 'medium', priority: 'P4' },
  { impact: 'low', urgency: 'low', priority: 'P4' },
];

export async function seedDefaultSlaPolicy(ctx: TenantContext): Promise<{ policyId: string; targets: number }> {
  return transaction(ctx, async (tx) => {
    let calendar = await tx.businessCalendar.findFirst({ where: { key: 'uk-office' } });
    if (!calendar) {
      calendar = await tx.businessCalendar.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: 'uk-office',
          name: 'UK office hours',
          timeZone: 'Europe/London',
          hours: OFFICE_HOURS as never,
          isDefault: true,
        },
      });
    }

    // P1 runs around the clock: a critical outage does not wait for Monday.
    let alwaysOpen = await tx.businessCalendar.findFirst({ where: { key: '24x7' } });
    if (!alwaysOpen) {
      alwaysOpen = await tx.businessCalendar.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: '24x7',
          name: 'Around the clock',
          timeZone: 'UTC',
          hours: {
            mon: [{ start: '00:00', end: '24:00' }],
            tue: [{ start: '00:00', end: '24:00' }],
            wed: [{ start: '00:00', end: '24:00' }],
            thu: [{ start: '00:00', end: '24:00' }],
            fri: [{ start: '00:00', end: '24:00' }],
            sat: [{ start: '00:00', end: '24:00' }],
            sun: [{ start: '00:00', end: '24:00' }],
          } as never,
        },
      });
    }

    let policy = await tx.slaPolicy.findFirst({ where: { key: 'default' } });
    if (!policy) {
      policy = await tx.slaPolicy.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: 'default',
          name: 'Default service targets',
          // The least specific policy: it matches anything nothing else claims.
          match: { always: true } as never,
          specificity: 0,
          calendarMode: 'policy',
          calendarId: calendar.id,
          status: 'published',
        },
      });
    }

    let p1Policy = await tx.slaPolicy.findFirst({ where: { key: 'default-p1' } });
    if (!p1Policy) {
      p1Policy = await tx.slaPolicy.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: 'default-p1',
          name: 'Critical incidents (around the clock)',
          match: { eq: [{ var: 'ticket.priority' }, 'P1'] } as never,
          specificity: 10,
          calendarMode: 'policy',
          calendarId: alwaysOpen.id,
          status: 'published',
        },
      });
    }

    let targets = 0;
    for (const row of DEFAULT_TARGETS) {
      const policyId = row.priority === 'P1' ? p1Policy.id : policy.id;
      for (const [targetType, minutes] of [
        ['response', row.response],
        ['update', row.update],
        ['resolution', row.resolution],
      ] as const) {
        const existing = await tx.slaTarget.findFirst({ where: { policyId, priority: row.priority, targetType } });
        if (existing) continue;
        await tx.slaTarget.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            policyId,
            priority: row.priority,
            targetType,
            minutes,
            warningThresholds: [50, 75, 90],
          },
        });
        targets += 1;
      }
    }

    for (const entry of PRIORITY_MATRIX) {
      const existing = await tx.priorityMatrix.findFirst({
        where: { impact: entry.impact, urgency: entry.urgency, orgId: null },
      });
      if (existing) continue;
      await tx.priorityMatrix.create({
        data: { id: newId(), tenantId: ctx.tenantId, orgId: null, ...entry },
      });
    }

    return { policyId: policy.id, targets };
  });
}
