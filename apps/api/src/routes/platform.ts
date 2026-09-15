import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, metrics, modules, systemContext, withContext } from '@itsm/platform';
import { describeMeter, planService, tenantService, usageService } from '@itsm/module-tenancy';
import { contextOf } from '../plugins/context.js';

/**
 * The platform surface (`/api/platform/v1`).
 *
 * Separate from the tenant API because it is operated by a different audience
 * with a different database role, and because a later extraction routes the
 * whole prefix elsewhere without touching tenant traffic.
 */
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    const ctx = contextOf(request);
    // Platform operations are never available to an ordinary tenant role.
    if (!ctx.permissions.has('platform.tenant.manage', 'any')) {
      throw new ForbiddenError('platform.tenant.manage');
    }
  });

  app.get('/tenants', async () => {
    const tenants = await tenantService.listTenants();
    return {
      data: tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        region: tenant.region,
        createdAt: tenant.createdAt.toISOString(),
      })),
    };
  });

  app.post('/tenants', async (request, reply) => {
    const input = tenantService.provisionTenantSchema.parse(request.body);
    const result = await tenantService.provisionTenant(input);
    reply.status(201);
    return result;
  });

  app.post('/tenants/:id/suspend', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().max(1000).optional() }).parse(request.body ?? {});
    await tenantService.suspendTenant(id, body.reason);
    return { id, status: 'suspended' };
  });

  app.post('/tenants/:id/resume', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await tenantService.resumeTenant(id);
    return { id, status: 'active' };
  });

  app.get('/modules', async () => ({
    data: modules().map((module) => ({
      id: module.id,
      key: module.key,
      name: module.name,
      version: module.version,
      phase: module.phase,
      dependsOn: module.dependsOn,
      optional: module.optional,
      permissions: module.permissions.length,
      publishes: module.events.publishes.length,
      consumes: module.events.consumes.length,
    })),
  }));

  // ---- Plans ---------------------------------------------------------------
  //
  // Plans are the deployment's, not a tenant's: defined here, read by every
  // tenant, and changed by nobody else (ADR-0038).

  const shape = (plan: { key: string; name: string; description: string | null; features: string[]; isRetired: boolean; sortOrder: number; limits: { meter: string; soft: bigint | null; hard: bigint | null }[] }) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    features: plan.features,
    isRetired: plan.isRetired,
    sortOrder: plan.sortOrder,
    limits: plan.limits
      .map((limit) => ({ meter: limit.meter, soft: limit.soft === null ? null : Number(limit.soft), hard: limit.hard === null ? null : Number(limit.hard) }))
      .sort((a, b) => a.meter.localeCompare(b.meter)),
  });

  app.get('/plans', async () => ({ data: (await planService.listPlans()).map(shape) }));

  app.put('/plans/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(40) }).parse(request.params);
    const saved = await planService.savePlan(ctx, { ...(request.body as object), key } as never);
    return shape(saved);
  });

  app.put('/tenants/:id/plan', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ planKey: z.string().min(1).max(40) }).parse(request.body);
    const tenant = await planService.assignPlan(ctx, id, body.planKey);
    return { id, planKey: tenant?.planKey ?? null };
  });

  /** What one tenant is using, for a support conversation about a refusal. */
  app.get('/tenants/:id/usage', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const tenant = await tenantService.findTenantById(id);
    if (!tenant) throw new NotFoundError('tenant', id);
    const ctx = systemContext(tenant.id, { region: tenant.region });
    const usage = await withContext(ctx, () => usageService.usageFor(ctx));
    return {
      planKey: usage.planKey,
      meters: usage.meters.map((meter) => ({
        meter: meter.meter,
        value: Number(meter.value),
        display: describeMeter(meter.meter, meter.value),
        state: meter.state,
        period: meter.periodKey,
        soft: meter.lines.soft === null ? null : Number(meter.lines.soft),
        hard: meter.lines.hard === null ? null : Number(meter.lines.hard),
      })),
    };
  });

  app.get('/metrics-snapshot', async () => metrics.snapshot());
}
