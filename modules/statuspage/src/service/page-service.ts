import { z } from 'zod';
import { ConflictError, NotFoundError, authz, newId, recordAudit, transaction, type TenantContext, type Tx } from '@itsm/platform';
import { COMPONENT_STATUSES } from '../domain/status.js';

/**
 * The page and its components, as an operator edits them.
 */

export const pageSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  timeZone: z.string().min(1).max(60).optional(),
  supportUrl: z.string().url().max(500).nullable().optional(),
});

export const componentSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(300).nullable().optional(),
  groupName: z.string().max(80).nullable().optional(),
  order: z.number().int().min(0).max(1000).default(0),
  serviceId: z.string().uuid().nullable().optional(),
  status: z.enum(COMPONENT_STATUSES).optional(),
  isVisible: z.boolean().default(true),
});

/** Where the page lives: /status/<tenant slug>. */
export function pathFor(slug: string): string {
  return `/status/${slug}`;
}

/**
 * The tenant's page, with the slug it is served under. The slug is the
 * tenant's own (ADR-0035): read from the tenant row, which the tenant role
 * may see for itself and nobody else.
 */
export async function loadPage(tx: Tx, ctx: TenantContext) {
  const page = await tx.statusPage.findFirst({ where: { tenantId: ctx.tenantId } });
  if (!page) throw new NotFoundError('status page', ctx.tenantId);
  const tenant = await tx.tenant.findFirst({ where: { id: ctx.tenantId }, select: { slug: true } });
  if (!tenant) throw new NotFoundError('tenant', ctx.tenantId);
  return { ...page, slug: tenant.slug, path: pathFor(tenant.slug) };
}

export async function getPage(ctx: TenantContext) {
  authz.require(ctx, 'statuspage.read');
  return transaction(ctx, async (tx) => {
    const page = await loadPage(tx, ctx);
    const components = await tx.statusComponent.findMany({ where: { pageId: page.id }, orderBy: [{ groupName: 'asc' }, { order: 'asc' }, { name: 'asc' }] });
    const subscribers = await tx.statusSubscriber.count({ where: { pageId: page.id, confirmedAt: { not: null }, unsubscribedAt: null } });
    return { ...page, components, subscribers };
  });
}

export async function updatePage(ctx: TenantContext, input: z.input<typeof pageSchema>) {
  authz.require(ctx, 'statuspage.manage');
  const parsed = pageSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const page = await loadPage(tx, ctx);
    const row = await tx.statusPage.update({
      where: { id: page.id },
      data: {
        name: parsed.name,
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.isPublic !== undefined ? { isPublic: parsed.isPublic } : {}),
        ...(parsed.timeZone ? { timeZone: parsed.timeZone } : {}),
        ...(parsed.supportUrl !== undefined ? { supportUrl: parsed.supportUrl } : {}),
      },
    });
    await recordAudit(tx, ctx, { action: 'statuspage.updated', targetType: 'status_page', targetId: row.id, before: { isPublic: page.isPublic, name: page.name }, after: parsed });
    return { ...row, slug: page.slug, path: page.path };
  });
}

export async function createComponent(ctx: TenantContext, input: z.input<typeof componentSchema>) {
  authz.require(ctx, 'statuspage.manage');
  const parsed = componentSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const page = await loadPage(tx, ctx);
    const existing = await tx.statusComponent.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a component with the key ${parsed.key} already exists`);
    const row = await tx.statusComponent.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        pageId: page.id,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        groupName: parsed.groupName ?? null,
        order: parsed.order,
        serviceId: parsed.serviceId ?? null,
        status: parsed.status ?? 'operational',
        isVisible: parsed.isVisible,
      },
    });
    await recordAudit(tx, ctx, { action: 'statuspage.component.created', targetType: 'status_component', targetId: row.id, after: parsed });
    return row;
  });
}

export async function updateComponent(ctx: TenantContext, key: string, input: Partial<z.input<typeof componentSchema>>) {
  authz.require(ctx, 'statuspage.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.statusComponent.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('status component', key);
    const patch = componentSchema.omit({ key: true }).partial().parse(input);
    const row = await tx.statusComponent.update({
      where: { id: existing.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.groupName !== undefined ? { groupName: patch.groupName } : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
        ...(patch.serviceId !== undefined ? { serviceId: patch.serviceId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.isVisible !== undefined ? { isVisible: patch.isVisible } : {}),
      },
    });
    await recordAudit(tx, ctx, { action: 'statuspage.component.updated', targetType: 'status_component', targetId: row.id, before: { status: existing.status }, after: patch });
    return row;
  });
}

export async function deleteComponent(ctx: TenantContext, key: string): Promise<void> {
  authz.require(ctx, 'statuspage.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.statusComponent.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('status component', key);
    await tx.statusComponent.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, { action: 'statuspage.component.deleted', targetType: 'status_component', targetId: existing.id, before: { key } });
  });
}

/**
 * Who asked to be told. Addresses, so behind `statuspage.read` rather than
 * open to anybody who can see the page: an operator needs them to honour a
 * removal request made by any route other than the link.
 */
export async function listSubscribers(ctx: TenantContext) {
  authz.require(ctx, 'statuspage.read');
  return transaction(ctx, (tx) => tx.statusSubscriber.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }));
}

export async function removeSubscriber(ctx: TenantContext, subscriberId: string): Promise<void> {
  authz.require(ctx, 'statuspage.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.statusSubscriber.findFirst({ where: { id: subscriberId } });
    if (!existing) throw new NotFoundError('status subscriber', subscriberId);
    await tx.statusSubscriber.delete({ where: { id: subscriberId } });
    // The address is not written into the audit trail: the row is gone
    // because somebody asked for it to be, and the trail should not keep it.
    await recordAudit(tx, ctx, { action: 'statuspage.subscriber.removed', targetType: 'status_subscriber', targetId: subscriberId });
  });
}

/** Components linked to any of these catalogue services. */
export async function componentsForServices(tx: Tx, serviceIds: string[]) {
  if (serviceIds.length === 0) return [];
  return tx.statusComponent.findMany({ where: { serviceId: { in: serviceIds } } });
}
