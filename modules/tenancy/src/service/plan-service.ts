import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  invalidateFlags,
  logger,
  newId,
  platformDb,
  publish,
  recordAudit,
  systemContext,
  transaction,
  withContext,
  type TenantContext,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { METERS, isMeter, type Lines, type Meter } from '../domain/meters.js';
import { invalidateVerdicts } from './verdict-cache.js';

/**
 * Plans, and which one a tenant is on.
 *
 * Ours, not a tenant's: a plan row carries no `tenant_id`, is written only
 * through the platform console, and is read by every tenant. A tenant sees
 * the plan it is on, what that allows and what it is using; it cannot move
 * itself, and the one thing it may change is its own warning threshold
 * (ADR-0038).
 */

export const planSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  features: z.array(z.string().min(1).max(120)).max(100).default([]),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  isRetired: z.boolean().default(false),
  limits: z
    .array(
      z.object({
        meter: z.enum(METERS),
        soft: z.number().int().min(0).nullable().optional(),
        hard: z.number().int().min(0).nullable().optional(),
      }),
    )
    .max(METERS.length)
    .default([]),
});
export type PlanInput = z.input<typeof planSchema>;

function assertLinesAreSane(limits: { meter: string; soft?: number | null; hard?: number | null }[]): void {
  for (const limit of limits) {
    if (limit.soft != null && limit.hard != null && limit.soft > limit.hard) {
      // A warning after the refusal is a warning nobody ever sees.
      throw new ValidationError(`the warning line for ${limit.meter} is above its hard limit; warn first, refuse second`);
    }
  }
}

/** Every plan, for the platform console and for a tenant reading its own. */
export async function listPlans() {
  return platformDb().plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }], include: { limits: true } });
}

export async function getPlan(key: string) {
  const plan = await platformDb().plan.findFirst({ where: { key }, include: { limits: true } });
  if (!plan) throw new NotFoundError('plan', key);
  return plan;
}

/** Creates or replaces a plan. Platform operators only; there is no tenant door. */
export async function savePlan(ctx: TenantContext, input: PlanInput) {
  authz.require(ctx, 'platform.plan.manage');
  const parsed = planSchema.parse(input);
  assertLinesAreSane(parsed.limits);

  const db = platformDb();
  const existing = await db.plan.findFirst({ where: { key: parsed.key } });
  await db.plan.upsert({
    where: { key: parsed.key },
    create: {
      key: parsed.key,
      name: parsed.name,
      description: parsed.description ?? null,
      features: parsed.features,
      sortOrder: parsed.sortOrder,
      isRetired: parsed.isRetired,
    },
    update: {
      name: parsed.name,
      description: parsed.description ?? null,
      features: parsed.features,
      sortOrder: parsed.sortOrder,
      isRetired: parsed.isRetired,
    },
  });

  // Replaced whole: a limit dropped from the input is a limit removed, and a
  // plan half-edited is how a tenant ends up refused by a line nobody meant
  // to keep.
  await db.planLimit.deleteMany({ where: { planKey: parsed.key } });
  for (const limit of parsed.limits) {
    await db.planLimit.create({
      data: {
        id: newId(),
        planKey: parsed.key,
        meter: limit.meter,
        soft: limit.soft == null ? null : BigInt(limit.soft),
        hard: limit.hard == null ? null : BigInt(limit.hard),
      },
    });
  }

  await transaction(ctx, (tx) =>
    recordAudit(tx, ctx, {
      action: existing ? 'plan.updated' : 'plan.created',
      targetType: 'plan',
      targetId: parsed.key,
      after: { name: parsed.name, limits: parsed.limits, features: parsed.features },
    }),
  );
  // Everyone on this plan is now measured against different lines. Their
  // cached verdicts are dropped one tenant at a time rather than by
  // scanning the cache: a plan has few tenants early and the pass is cheap,
  // and by the time it is not, a minute of staleness is the least of it.
  const onPlan = await db.tenant.findMany({ where: { planKey: parsed.key }, select: { id: true } });
  for (const tenant of onPlan) await invalidateVerdicts(tenant.id);

  logger.info('plan saved', { plan: parsed.key, limits: parsed.limits.length, tenants: onPlan.length });
  return getPlan(parsed.key);
}

/** Moves a tenant onto a plan. The features it gates take effect at once. */
export async function assignPlan(ctx: TenantContext, tenantId: string, planKey: string) {
  authz.require(ctx, 'platform.plan.manage');
  const db = platformDb();
  const [plan, tenant] = await Promise.all([db.plan.findFirst({ where: { key: planKey } }), db.tenant.findFirst({ where: { id: tenantId } })]);
  if (!plan) throw new NotFoundError('plan', planKey);
  if (!tenant) throw new NotFoundError('tenant', tenantId);
  if (plan.isRetired && tenant.planKey !== planKey) throw new ConflictError(`the ${planKey} plan is retired; nobody new goes onto it`);
  if (tenant.planKey === planKey) return tenant;

  await db.tenant.update({ where: { id: tenantId }, data: { planKey } });
  await invalidateFlags(tenantId);
  // The cached verdicts were computed against the old lines. An upgrade
  // that took a minute to take effect would be a support call every time.
  await invalidateVerdicts(tenantId);

  const tenantCtx = systemContext(tenantId, { region: tenant.region });
  await withContext(tenantCtx, () =>
    transaction(tenantCtx, async (tx) => {
      await recordAudit(tx, tenantCtx, { action: 'plan.changed', targetType: 'tenant', targetId: tenantId, before: { planKey: tenant.planKey }, after: { planKey } });
      await publish(tx, tenantCtx, {
        definition: events.planChanged,
        aggregateId: tenantId,
        payload: { tenantId, fromPlanKey: tenant.planKey, toPlanKey: planKey },
      });
    }),
  );
  return db.tenant.findFirst({ where: { id: tenantId } });
}

/**
 * The lines that apply to a tenant right now: the plan's, with the tenant's
 * own warning threshold where it set one.
 *
 * A tenant may only lower the warning — bring it forward, so it hears sooner
 * — or raise it as far as the hard line, never past it, and never touch the
 * hard line itself. `linesFor` is where that is true rather than in the
 * route, so no future caller can get it wrong.
 */
export async function linesFor(tenantId: string): Promise<{ planKey: string; lines: Record<Meter, Lines> }> {
  const db = platformDb();
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { planKey: true, region: true } });
  const planKey = tenant?.planKey ?? null;
  const limits = planKey ? await db.planLimit.findMany({ where: { planKey } }) : [];

  const lines = Object.fromEntries(METERS.map((meter) => [meter, { soft: null, hard: null } as Lines])) as Record<Meter, Lines>;
  for (const limit of limits) {
    if (isMeter(limit.meter)) lines[limit.meter] = { soft: limit.soft, hard: limit.hard };
  }

  // A tenant with no plan has no limits. That is the right default: a
  // deployment that has not started selling anything should not refuse work.
  if (!planKey) return { planKey: 'none', lines };

  const overrideCtx = systemContext(tenantId, { region: tenant?.region ?? 'eu-west' });
  const overrides = await withContext(overrideCtx, () => transaction(overrideCtx, (tx) => tx.tenantLimitOverride.findMany()));
  for (const override of overrides) {
    if (!isMeter(override.meter)) continue;
    const hard = lines[override.meter].hard;
    if (hard !== null && override.soft > hard) continue;
    lines[override.meter] = { ...lines[override.meter], soft: override.soft };
  }
  return { planKey, lines };
}

export const softOverrideSchema = z.object({ meter: z.enum(METERS), soft: z.number().int().min(0).nullable() });

/** A tenant administrator's own warning threshold. Refused above the hard line. */
export async function setSoftLimit(ctx: TenantContext, input: z.input<typeof softOverrideSchema>) {
  authz.require(ctx, 'tenant.limit.manage');
  await invalidateVerdicts(ctx.tenantId);
  const parsed = softOverrideSchema.parse(input);
  const { lines, planKey } = await linesFor(ctx.tenantId);
  const hard = lines[parsed.meter].hard;
  if (parsed.soft !== null && hard !== null && BigInt(parsed.soft) > hard) {
    throw new ValidationError(
      `the ${planKey} plan refuses ${parsed.meter} at ${hard}, so a warning at ${parsed.soft} would never arrive; choose something below the limit`,
    );
  }

  return transaction(ctx, async (tx) => {
    const existing = await tx.tenantLimitOverride.findFirst({ where: { meter: parsed.meter } });
    if (parsed.soft === null) {
      if (existing) await tx.tenantLimitOverride.delete({ where: { id: existing.id } });
      await recordAudit(tx, ctx, { action: 'tenant.limit.reset', targetType: 'usage_meter', targetId: parsed.meter, before: { soft: existing ? Number(existing.soft) : null } });
      return null;
    }
    const row = existing
      ? await tx.tenantLimitOverride.update({ where: { id: existing.id }, data: { soft: BigInt(parsed.soft), createdBy: ctx.actor.id } })
      : await tx.tenantLimitOverride.create({ data: { id: newId(), tenantId: ctx.tenantId, meter: parsed.meter, soft: BigInt(parsed.soft), createdBy: ctx.actor.id } });
    await recordAudit(tx, ctx, { action: 'tenant.limit.warned_at', targetType: 'usage_meter', targetId: parsed.meter, after: { soft: parsed.soft } });
    return row;
  });
}
