import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError, authz, newId, recordAudit, transaction, type TenantContext, type Tx } from '@itsm/platform';

/**
 * Activity types and what an hour of each costs.
 *
 * A rate resolves team first, then the activity's default. Resolution happens
 * when an entry is logged and the answer is written on the entry, so the
 * question "what did that cost" has one answer for ever.
 */

export const activityTypeSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  billable: z.boolean().default(true),
  ratePerHour: z.number().min(0).max(1_000_000).default(0),
  currency: z.string().length(3).toUpperCase().default('GBP'),
  isActive: z.boolean().default(true),
});
export type ActivityTypeInput = z.input<typeof activityTypeSchema>;

export const rateSchema = z.object({
  teamId: z.string().uuid(),
  ratePerHour: z.number().min(0).max(1_000_000),
  currency: z.string().length(3).toUpperCase().default('GBP'),
});

export async function listActivityTypes(ctx: TenantContext) {
  authz.require(ctx, 'time.read');
  return transaction(ctx, (tx) => tx.activityType.findMany({ orderBy: [{ isSystem: 'asc' }, { name: 'asc' }], include: { rates: true } }));
}

export async function createActivityType(ctx: TenantContext, input: ActivityTypeInput) {
  authz.require(ctx, 'time.manage');
  const parsed = activityTypeSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const existing = await tx.activityType.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`an activity type with the key ${parsed.key} already exists`);
    const row = await tx.activityType.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        billable: parsed.billable,
        ratePerHour: parsed.ratePerHour,
        currency: parsed.currency,
        isActive: parsed.isActive,
      },
    });
    await recordAudit(tx, ctx, { action: 'time.activity.created', targetType: 'activity_type', targetId: row.id, after: parsed });
    return row;
  });
}

export async function updateActivityType(ctx: TenantContext, key: string, input: Partial<ActivityTypeInput>) {
  authz.require(ctx, 'time.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.activityType.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('activity type', key);
    if (existing.isSystem && input.isActive === false) throw new ValidationError('the system activity type cannot be retired');
    const patch = activityTypeSchema.omit({ key: true }).partial().parse(input);
    const row = await tx.activityType.update({
      where: { id: existing.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
        ...(patch.ratePerHour !== undefined ? { ratePerHour: patch.ratePerHour } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    await recordAudit(tx, ctx, { action: 'time.activity.updated', targetType: 'activity_type', targetId: row.id, before: { ratePerHour: Number(existing.ratePerHour) }, after: patch });
    return row;
  });
}

/** Sets or replaces a team's rate for an activity. */
export async function setTeamRate(ctx: TenantContext, key: string, input: z.input<typeof rateSchema>) {
  authz.require(ctx, 'time.manage');
  const parsed = rateSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const type = await tx.activityType.findFirst({ where: { key } });
    if (!type) throw new NotFoundError('activity type', key);
    const team = await tx.team.findFirst({ where: { id: parsed.teamId, deletedAt: null }, select: { id: true } });
    if (!team) throw new NotFoundError('team', parsed.teamId);
    const row = await tx.costRate.upsert({
      where: { tenantId_activityTypeId_teamId: { tenantId: ctx.tenantId, activityTypeId: type.id, teamId: parsed.teamId } },
      create: { id: newId(), tenantId: ctx.tenantId, activityTypeId: type.id, teamId: parsed.teamId, ratePerHour: parsed.ratePerHour, currency: parsed.currency },
      update: { ratePerHour: parsed.ratePerHour, currency: parsed.currency },
    });
    await recordAudit(tx, ctx, { action: 'time.rate.set', targetType: 'cost_rate', targetId: row.id, after: { activity: key, ...parsed } });
    return row;
  });
}

export async function removeTeamRate(ctx: TenantContext, key: string, teamId: string): Promise<void> {
  authz.require(ctx, 'time.manage');
  await transaction(ctx, async (tx) => {
    const type = await tx.activityType.findFirst({ where: { key } });
    if (!type) throw new NotFoundError('activity type', key);
    await tx.costRate.deleteMany({ where: { activityTypeId: type.id, teamId } });
    await recordAudit(tx, ctx, { action: 'time.rate.removed', targetType: 'cost_rate', targetId: type.id, before: { activity: key, teamId } });
  });
}

/** The rate that applies now for an activity on a team: the team's, else the default. */
export async function rateFor(tx: Tx, activityTypeId: string, teamId: string | null): Promise<{ ratePerHour: number; currency: string }> {
  if (teamId) {
    const override = await tx.costRate.findFirst({ where: { activityTypeId, teamId } });
    if (override) return { ratePerHour: Number(override.ratePerHour), currency: override.currency };
  }
  const type = await tx.activityType.findFirst({ where: { id: activityTypeId } });
  if (!type) throw new NotFoundError('activity type', activityTypeId);
  return { ratePerHour: Number(type.ratePerHour), currency: type.currency };
}
