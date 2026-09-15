import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The page a tenant starts with: named after the tenant, public, with one
 * component per active catalogue service, linked to it.
 *
 * Seeded rather than left for somebody to create, because the handlers need
 * a page to write to from the first customer-facing incident, and the
 * component link is what lets an incident against a service find the thing
 * to mark. A tenant that wants none of this makes the page private.
 *
 * Runs after the catalogue seed, so the default service is a component too.
 */
export async function seedStatusDefaults(ctx: TenantContext): Promise<{ created: boolean; components: number }> {
  return transaction(ctx, async (tx) => {
    let page = await tx.statusPage.findFirst({ where: { tenantId: ctx.tenantId } });
    let created = false;
    if (!page) {
      const tenant = await tx.tenant.findFirst({ where: { id: ctx.tenantId }, select: { name: true } });
      page = await tx.statusPage.create({
        data: { id: newId(), tenantId: ctx.tenantId, name: tenant?.name ?? 'Service status', isPublic: true },
      });
      created = true;
    }

    // Idempotent on the component key, so re-running after a service was
    // added lists it and re-running otherwise changes nothing.
    const services = await tx.service.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } });
    const existing = new Set((await tx.statusComponent.findMany({ where: { pageId: page.id }, select: { key: true } })).map((row) => row.key));
    let components = 0;
    for (const [index, service] of services.entries()) {
      if (existing.has(service.key)) continue;
      await tx.statusComponent.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          pageId: page.id,
          key: service.key,
          name: service.name,
          description: service.description,
          order: index,
          serviceId: service.id,
        },
      });
      components += 1;
    }
    return { created, components };
  });
}
