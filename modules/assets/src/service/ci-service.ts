import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { attributeListSchema, assertAttributes, inheritedAttributes } from '../domain/attributes.js';
import {
  CI_STATUSES,
  CRITICALITIES,
  RELATIONSHIP_TYPES,
  assertRelationship,
  describe,
  type RelationshipType,
} from '../domain/relationships.js';
import { classChain } from '../repo/graph-repo.js';
import { invalidateTraversals } from './impact-service.js';

/**
 * The register of things that can break, and what depends on what.
 *
 * Every write here is made by somebody who decided to make it. Nothing in this
 * module infers a relationship, because a CMDB that guesses is a CMDB that is
 * quietly wrong, and quietly wrong is worse than empty: an empty CMDB sends
 * people to ask somebody who knows, a wrong one sends them somewhere else
 * entirely. Discovery (E2) will propose; a person will still confirm.
 */

// ---- Classes ---------------------------------------------------------------

export const classSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/, 'lower snake case'),
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).optional(),
  parentKey: z.string().max(60).optional(),
  attributes: attributeListSchema.optional(),
});

export async function createClass(ctx: TenantContext, input: z.input<typeof classSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = classSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.ciClass.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a class with the key ${parsed.key} already exists`);

    const parent = parsed.parentKey ? await tx.ciClass.findFirst({ where: { key: parsed.parentKey } }) : null;
    if (parsed.parentKey && !parent) throw new NotFoundError('configuration item class', parsed.parentKey);

    const id = newId();
    const created = await tx.ciClass.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        parentId: parent?.id ?? null,
        attributes: parsed.attributes ?? [],
      },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.class.created',
      targetType: 'ci_class',
      targetId: id,
      after: { key: parsed.key, parentKey: parsed.parentKey ?? null, attributes: parsed.attributes ?? [] },
    });
    return created;
  });
}

export const updateClassSchema = classSchema.partial().omit({ key: true });

export async function updateClass(ctx: TenantContext, key: string, input: z.input<typeof updateClassSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = updateClassSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const target = await loadClass(tx, key);

    let parentId = target.parentId;
    if (parsed.parentKey !== undefined) {
      if (parsed.parentKey === '') {
        parentId = null;
      } else {
        const parent = await tx.ciClass.findFirst({ where: { key: parsed.parentKey } });
        if (!parent) throw new NotFoundError('configuration item class', parsed.parentKey);
        // A class that is its own ancestor makes `classChain` terminate on its
        // depth bound rather than on the root, which means the attributes it
        // reports depend on where the loop happens to be cut. Refused here,
        // where somebody can still see what they meant.
        const ancestry = await classChain(tx, ctx.tenantId, parent.id);
        if (parent.id === target.id || ancestry.some((level) => level.id === target.id)) {
          throw new ValidationError(`${parsed.parentKey} is already below ${key}; that would make a loop`);
        }
        parentId = parent.id;
      }
    }

    const updated = await tx.ciClass.update({
      where: { id: target.id },
      data: {
        name: parsed.name ?? target.name,
        description: parsed.description ?? target.description,
        parentId,
        ...(parsed.attributes !== undefined ? { attributes: parsed.attributes } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.class.updated',
      targetType: 'ci_class',
      targetId: target.id,
      before: { name: target.name, parentId: target.parentId },
      after: { name: updated.name, parentId },
    });
    return updated;
  });
}

export function listClasses(ctx: TenantContext) {
  authz.require(ctx, 'cmdb.read');
  return transaction(ctx, (tx) => tx.ciClass.findMany({ where: { status: 'active' }, orderBy: { key: 'asc' } }));
}

/** Everything a configuration item of this class must and may carry. */
export async function classAttributes(ctx: TenantContext, key: string) {
  authz.require(ctx, 'cmdb.read');
  return transaction(ctx, async (tx) => {
    const target = await loadClass(tx, key);
    return inheritedAttributes(await classChain(tx, ctx.tenantId, target.id));
  });
}

async function loadClass(tx: Tx, key: string) {
  const found = await tx.ciClass.findFirst({ where: { key } });
  if (!found) throw new NotFoundError('configuration item class', key);
  return found;
}

// ---- Configuration items ---------------------------------------------------

export const createCiSchema = z.object({
  classKey: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  externalKey: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  criticality: z.enum(CRITICALITIES).default('medium'),
  serviceId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  environment: z.string().max(60).optional(),
  attributes: z.record(z.unknown()).default({}),
  source: z.enum(['manual', 'import', 'discovery']).default('manual'),
});

export async function createCi(ctx: TenantContext, input: z.input<typeof createCiSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = createCiSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const ciClass = await loadClass(tx, parsed.classKey);
    assertAttributes(inheritedAttributes(await classChain(tx, ctx.tenantId, ciClass.id)), parsed.attributes);

    if (parsed.externalKey) {
      const clash = await tx.configurationItem.findFirst({ where: { externalKey: parsed.externalKey } });
      if (clash) {
        // The external key is what reconciliation matches on. Two items sharing
        // one is how a discovery run ends up overwriting the wrong record.
        throw new ConflictError(`${parsed.externalKey} already identifies ${clash.name}`, { id: clash.id });
      }
    }

    const id = newId();
    const ci = await tx.configurationItem.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        classId: ciClass.id,
        name: parsed.name,
        externalKey: parsed.externalKey ?? null,
        description: parsed.description ?? null,
        criticality: parsed.criticality,
        serviceId: parsed.serviceId ?? null,
        ownerId: parsed.ownerId ?? null,
        environment: parsed.environment ?? null,
        attributes: parsed.attributes as never,
        source: parsed.source,
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.ci.created',
      targetType: 'configuration_item',
      targetId: id,
      after: { name: parsed.name, classKey: parsed.classKey, criticality: parsed.criticality },
    });
    await publish(tx, ctx, {
      definition: events.ciRegistered,
      aggregateId: id,
      payload: {
        ciId: id,
        name: parsed.name,
        classKey: parsed.classKey,
        criticality: parsed.criticality,
        serviceId: parsed.serviceId ?? null,
        source: parsed.source,
      },
    });
    metrics.increment('cmdb_ci_created_total', { source: parsed.source });
    return ci;
  });
}

export const updateCiSchema = createCiSchema.partial().omit({ classKey: true, source: true });

export async function updateCi(ctx: TenantContext, ciId: string, input: z.input<typeof updateCiSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = updateCiSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const ci = await loadCi(tx, ciId);
    if (ci.retiredAt) throw new ValidationError('this configuration item is retired; nothing about it should change now');

    if (parsed.attributes !== undefined) {
      // Validated as a whole rather than per key: a required attribute cannot
      // be checked by looking only at the keys somebody happened to send.
      const merged = { ...(ci.attributes as Record<string, unknown>), ...parsed.attributes };
      assertAttributes(inheritedAttributes(await classChain(tx, ctx.tenantId, ci.classId)), merged);
      parsed.attributes = merged;
    }

    const updated = await tx.configurationItem.update({
      where: { id: ci.id },
      data: {
        name: parsed.name ?? ci.name,
        description: parsed.description ?? ci.description,
        criticality: parsed.criticality ?? ci.criticality,
        serviceId: parsed.serviceId ?? ci.serviceId,
        ownerId: parsed.ownerId ?? ci.ownerId,
        environment: parsed.environment ?? ci.environment,
        externalKey: parsed.externalKey ?? ci.externalKey,
        ...(parsed.attributes !== undefined ? { attributes: parsed.attributes as never } : {}),
        version: { increment: 1 },
      },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.ci.updated',
      targetType: 'configuration_item',
      targetId: ci.id,
      before: { name: ci.name, criticality: ci.criticality, serviceId: ci.serviceId },
      after: { name: updated.name, criticality: updated.criticality, serviceId: updated.serviceId },
    });
    return updated;
  });
}

export const statusSchema = z.object({
  status: z.enum(CI_STATUSES),
  note: z.string().max(2_000).optional(),
});

/**
 * Moves a configuration item between operational, degraded and down.
 *
 * Published, because "the database is down" is a fact other modules act on —
 * a rule raising a major incident, a notification to the service owner — and
 * a CMDB whose status nobody hears about is a spreadsheet with a schema.
 *
 * `retired` is not reachable from here; retiring is its own operation, because
 * it is the one that is meant to be hard to do by accident.
 */
export async function setStatus(ctx: TenantContext, ciId: string, input: z.input<typeof statusSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = statusSchema.parse(input);
  const status = parsed.status;
  if (status === 'retired') throw new ValidationError('retire it through the retire operation, which records why');

  return transaction(ctx, async (tx) => {
    const ci = await loadCi(tx, ciId);
    if (ci.retiredAt) throw new ValidationError('this configuration item is retired');
    if (ci.status === status) return ci;

    const updated = await tx.configurationItem.update({
      where: { id: ci.id },
      data: { status, version: { increment: 1 } },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.ci.status.changed',
      targetType: 'configuration_item',
      targetId: ci.id,
      before: { status: ci.status },
      after: { status, note: parsed.note ?? null },
    });
    await publish(tx, ctx, {
      definition: events.ciStatusChanged,
      aggregateId: ci.id,
      payload: {
        ciId: ci.id,
        name: ci.name,
        from: ci.status,
        to: status,
        criticality: ci.criticality,
        serviceId: ci.serviceId,
        note: parsed.note ?? null,
      },
    });
    metrics.increment('cmdb_ci_status_changed_total', { to: status });
    return updated;
  });
}

/**
 * Takes it out of service without taking it out of the record.
 *
 * Never a delete. Deleting a configuration item breaks every incident, problem
 * and change that named it, and the history is the whole reason to keep a CMDB
 * — the question asked six months later is "what was this, and what did we do
 * to it?", and that question has no answer if the row is gone.
 */
export async function retireCi(ctx: TenantContext, ciId: string, reason: string) {
  authz.require(ctx, 'cmdb.manage');
  if (!reason.trim()) throw new ValidationError('say why it is being retired');

  return transaction(ctx, async (tx) => {
    const ci = await loadCi(tx, ciId);
    if (ci.retiredAt) return ci;

    const dependants = await tx.ciRelationship.count({
      where: { toCi: ci.id, type: { in: ['depends_on', 'runs_on', 'installed_on'] } },
    });

    const retired = await tx.configurationItem.update({
      where: { id: ci.id },
      data: { status: 'retired', retiredAt: new Date(), version: { increment: 1 } },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.ci.retired',
      targetType: 'configuration_item',
      targetId: ci.id,
      before: { status: ci.status },
      after: { status: 'retired', reason, dependants },
    });
    await publish(tx, ctx, {
      definition: events.ciRetired,
      aggregateId: ci.id,
      payload: {
        ciId: ci.id,
        name: ci.name,
        reason,
        serviceId: ci.serviceId,
        // Worth saying out loud: retiring something other things still point at
        // is usually a record that was never cleaned up, and occasionally it is
        // somebody about to decommission a machine that is still load-bearing.
        dependants,
      },
    });
    return retired;
  }).finally(() => invalidateTraversals(ctx.tenantId));
}

export function getCi(ctx: TenantContext, ciId: string) {
  authz.require(ctx, 'cmdb.read');
  return transaction(ctx, (tx) => loadCi(tx, ciId));
}

export const listCiSchema = z.object({
  classKey: z.string().max(60).optional(),
  status: z.enum(CI_STATUSES).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  serviceId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  includeRetired: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listCis(ctx: TenantContext, query: z.input<typeof listCiSchema> = {}) {
  authz.require(ctx, 'cmdb.read');
  const parsed = listCiSchema.parse(query);

  return transaction(ctx, async (tx) => {
    const ciClass = parsed.classKey ? await loadClass(tx, parsed.classKey) : null;
    return tx.configurationItem.findMany({
      where: {
        ...(ciClass ? { classId: ciClass.id } : {}),
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.criticality ? { criticality: parsed.criticality } : {}),
        ...(parsed.serviceId ? { serviceId: parsed.serviceId } : {}),
        ...(parsed.includeRetired ? {} : { retiredAt: null }),
        ...(parsed.search
          ? {
              OR: [
                { name: { contains: parsed.search, mode: 'insensitive' as const } },
                { externalKey: { contains: parsed.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
      take: parsed.limit,
    });
  });
}

async function loadCi(tx: Tx, ciId: string) {
  const ci = await tx.configurationItem.findFirst({ where: { id: ciId } });
  if (!ci) throw new NotFoundError('configuration item', ciId);
  return ci;
}

// ---- Relationships ---------------------------------------------------------

export const relationshipSchema = z.object({
  fromCi: z.string().uuid(),
  toCi: z.string().uuid(),
  type: z.enum(RELATIONSHIP_TYPES),
});

/**
 * Records that one thing needs another.
 *
 * Idempotent: asking twice for the same edge is not an error, because the
 * callers that ask twice are imports and re-runs, and making them fail is how
 * an import of four hundred rows stops on row nine.
 */
export async function relate(ctx: TenantContext, input: z.input<typeof relationshipSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = relationshipSchema.parse(input);
  assertRelationship(parsed.fromCi, parsed.toCi, parsed.type);
  const type: RelationshipType = parsed.type;

  return transaction(ctx, async (tx) => {
    const from = await loadCi(tx, parsed.fromCi);
    const to = await loadCi(tx, parsed.toCi);
    if (from.retiredAt || to.retiredAt) {
      throw new ValidationError('one of these is retired; a retired item takes no new relationships');
    }

    const existing = await tx.ciRelationship.findFirst({
      where: { fromCi: from.id, toCi: to.id, type },
    });
    if (existing) return { relationship: existing, created: false, description: describe(type, from.name, to.name) };

    const id = newId();
    const relationship = await tx.ciRelationship.create({
      data: { id, tenantId: ctx.tenantId, fromCi: from.id, toCi: to.id, type, createdBy: ctx.actor.id },
    });

    await recordAudit(tx, ctx, {
      action: 'cmdb.relationship.created',
      targetType: 'ci_relationship',
      targetId: id,
      after: { fromCi: from.id, toCi: to.id, type, reads: describe(type, from.name, to.name) },
    });
    return { relationship, created: true, description: describe(type, from.name, to.name) };
  }).finally(() => invalidateTraversals(ctx.tenantId));
}

export async function unrelate(ctx: TenantContext, input: z.input<typeof relationshipSchema>) {
  authz.require(ctx, 'cmdb.manage');
  const parsed = relationshipSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.ciRelationship.findFirst({
      where: { fromCi: parsed.fromCi, toCi: parsed.toCi, type: parsed.type },
    });
    if (!existing) throw new NotFoundError('relationship');

    await tx.ciRelationship.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, {
      action: 'cmdb.relationship.deleted',
      targetType: 'ci_relationship',
      targetId: existing.id,
      before: { fromCi: parsed.fromCi, toCi: parsed.toCi, type: parsed.type },
    });
    return { deleted: true };
  }).finally(() => invalidateTraversals(ctx.tenantId));
}

/** The edges either side of one configuration item, one hop out. */
export async function relationshipsOf(ctx: TenantContext, ciId: string) {
  authz.require(ctx, 'cmdb.read');
  return transaction(ctx, async (tx) => {
    const ci = await loadCi(tx, ciId);
    const [outgoing, incoming] = await Promise.all([
      tx.ciRelationship.findMany({ where: { fromCi: ci.id }, include: { to: { select: { id: true, name: true, status: true } } } }),
      tx.ciRelationship.findMany({ where: { toCi: ci.id }, include: { from: { select: { id: true, name: true, status: true } } } }),
    ]);
    return { ci, outgoing, incoming };
  });
}
