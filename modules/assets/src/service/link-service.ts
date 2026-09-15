import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  recordAudit,
  transaction,
} from '@itsm/platform';

/**
 * What a ticket, incident, problem or change touched.
 *
 * This is the gap MOD-08 left. A change record that cannot name what it changed
 * is a change record you cannot correlate with the outage that followed it, and
 * "what changed on this box last week?" is the first question asked in every
 * incident that turns out to have been self-inflicted.
 *
 * One table for every kind of record rather than a link table per module. The
 * question reaches across all of them, and four tables would mean four queries,
 * one of which somebody forgets to add when the fifth module arrives.
 */

export const ENTITY_TYPES = ['ticket', 'major_incident', 'problem', 'change'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * `affected` — the record is about this item.
 * `caused_by` — this item is why the record exists.
 * `changed`  — the record altered this item.
 */
export const LINK_ROLES = ['affected', 'caused_by', 'changed'] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

/**
 * The far side is not checked to exist.
 *
 * Deliberate: this module owns the link table and validates its own side of it.
 * Reaching into the ticket, incident, problem and change tables to check the
 * other would couple the CMDB to four modules' schemas to catch a mistake the
 * writer cannot easily make — the callers that matter are those modules
 * themselves, going through `linkCiIn` with the record already in hand.
 */
export const linkSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid(),
  ciId: z.string().uuid(),
  role: z.enum(LINK_ROLES).default('affected'),
});

/**
 * Links within the caller's transaction.
 *
 * Exported for the modules that will write these links as part of their own
 * work — a change naming what it will touch, a major incident naming what went
 * down — so the link and the record commit together. A link written in a
 * separate transaction is a link that survives a rolled-back change, pointing
 * at something that never happened.
 */
export async function linkCiIn(
  ctx: TenantContext,
  tx: Tx,
  input: z.infer<typeof linkSchema>,
): Promise<{ id: string; created: boolean }> {
  const ci = await tx.configurationItem.findFirst({ where: { id: input.ciId }, select: { id: true, retiredAt: true } });
  if (!ci) throw new NotFoundError('configuration item', input.ciId);
  if (ci.retiredAt && input.role === 'changed') {
    throw new ValidationError('that configuration item is retired; it cannot be what this change altered');
  }

  const existing = await tx.affectedCi.findFirst({
    where: { entityType: input.entityType, entityId: input.entityId, ciId: input.ciId, role: input.role },
    select: { id: true },
  });
  // Idempotent. The callers that link twice are retries and imports, and
  // failing them turns a duplicate click into an error somebody has to read.
  if (existing) return { id: existing.id, created: false };

  const id = newId();
  await tx.affectedCi.create({
    data: {
      id,
      tenantId: ctx.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      ciId: input.ciId,
      role: input.role,
      linkedBy: ctx.actor.id,
    },
  });
  await recordAudit(tx, ctx, {
    action: 'cmdb.ci.linked',
    targetType: 'configuration_item',
    targetId: input.ciId,
    after: { entityType: input.entityType, entityId: input.entityId, role: input.role },
  });
  return { id, created: true };
}

export async function linkCi(ctx: TenantContext, input: z.input<typeof linkSchema>) {
  authz.require(ctx, 'cmdb.link');
  const parsed = linkSchema.parse(input);
  return transaction(ctx, (tx) => linkCiIn(ctx, tx, parsed));
}

export async function unlinkCi(ctx: TenantContext, input: z.input<typeof linkSchema>) {
  authz.require(ctx, 'cmdb.link');
  const parsed = linkSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.affectedCi.findFirst({
      where: { entityType: parsed.entityType, entityId: parsed.entityId, ciId: parsed.ciId, role: parsed.role },
    });
    if (!existing) throw new NotFoundError('link');

    await tx.affectedCi.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, {
      action: 'cmdb.ci.unlinked',
      targetType: 'configuration_item',
      targetId: parsed.ciId,
      before: { entityType: parsed.entityType, entityId: parsed.entityId, role: parsed.role },
    });
    return { deleted: true };
  });
}

/** What one record touched, with enough of each item to be readable. */
export async function cisFor(ctx: TenantContext, entityType: EntityType, entityId: string) {
  authz.require(ctx, 'cmdb.read');
  return transaction(ctx, async (tx) => {
    const links = await tx.affectedCi.findMany({
      where: { entityType, entityId },
      orderBy: { linkedAt: 'asc' },
      take: 200,
    });
    if (links.length === 0) return [];

    const items = await tx.configurationItem.findMany({
      where: { id: { in: links.map((link) => link.ciId) } },
      select: { id: true, name: true, status: true, criticality: true, serviceId: true },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    return links.map((link) => ({ role: link.role, linkedAt: link.linkedAt, ci: byId.get(link.ciId) ?? null }));
  });
}

/**
 * Everything that has touched one configuration item, newest first.
 *
 * The correlation question, and the reason the link table is one table: this
 * returns the change from Tuesday and the incident from Wednesday in the same
 * list, in order, which is usually all anybody needs to see.
 */
export async function historyFor(ctx: TenantContext, ciId: string, limit = 50) {
  authz.require(ctx, 'cmdb.read');
  return transaction(ctx, async (tx) => {
    const ci = await tx.configurationItem.findFirst({ where: { id: ciId }, select: { id: true, name: true } });
    if (!ci) throw new NotFoundError('configuration item', ciId);

    const links = await tx.affectedCi.findMany({
      where: { ciId },
      orderBy: { linkedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return {
      ci,
      links: links.map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        role: link.role,
        linkedAt: link.linkedAt,
      })),
    };
  });
}
