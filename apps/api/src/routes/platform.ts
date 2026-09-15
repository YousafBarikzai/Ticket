import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ForbiddenError, metrics, modules } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
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

  app.get('/metrics-snapshot', async () => metrics.snapshot());
}
