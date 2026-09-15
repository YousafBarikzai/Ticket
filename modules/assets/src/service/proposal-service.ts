import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { assertAttributes, inheritedAttributes } from '../domain/attributes.js';
import { assertRelationship } from '../domain/relationships.js';
import { unflatten } from '../domain/reconcile.js';
import { classChain } from '../repo/graph-repo.js';
import { invalidateTraversals } from './impact-service.js';

/**
 * The queue where discovery waits for an answer.
 *
 * This is the half of E2 that makes the other half safe. Accepting a proposal
 * writes the register, so it takes the same permission as writing the register
 * by hand — `cmdb.manage`, not a new permission of its own. Inventing a
 * separate "may accept discovery" permission would be a way to write the
 * register without the permission to write the register, which is the kind of
 * gap nobody notices until an audit.
 *
 * Rejecting is remembered. A proposal somebody has already said no to is not
 * raised again by the next run, or saying no would cost a click a day for ever
 * and the queue would train people to accept everything to make it stop.
 */

export const listProposalSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'superseded']).default('pending'),
  sourceKey: z.string().max(60).optional(),
  kind: z.enum(['create_ci', 'update_ci', 'create_relationship']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listProposals(ctx: TenantContext, query: z.input<typeof listProposalSchema> = {}) {
  authz.require(ctx, 'discovery.read');
  const parsed = listProposalSchema.parse(query);

  return transaction(ctx, async (tx) => {
    const source = parsed.sourceKey ? await tx.discoverySource.findFirst({ where: { key: parsed.sourceKey } }) : null;
    if (parsed.sourceKey && !source) throw new NotFoundError('discovery source', parsed.sourceKey);

    return tx.discoveryProposal.findMany({
      where: {
        status: parsed.status,
        ...(source ? { sourceId: source.id } : {}),
        ...(parsed.kind ? { kind: parsed.kind } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: parsed.limit,
    });
  });
}

export async function acceptProposal(ctx: TenantContext, proposalId: string) {
  // Accepting writes the register, so it needs the permission to write it.
  authz.require(ctx, 'cmdb.manage');

  const outcome = await transaction(ctx, async (tx) => {
    const proposal = await load(tx, proposalId);
    const result = await apply(ctx, tx, proposal);

    await tx.discoveryProposal.update({
      where: { id: proposal.id },
      data: { status: 'accepted', decidedAt: new Date(), decidedBy: ctx.actor.id, ciId: result.ciId },
    });
    await recordAudit(tx, ctx, {
      action: 'discovery.proposal.accepted',
      targetType: 'configuration_item',
      targetId: result.ciId,
      after: { proposalId: proposal.id, kind: proposal.kind, externalKey: proposal.externalKey },
    });
    await publish(tx, ctx, {
      definition: events.discoveryProposalDecided,
      aggregateId: proposal.id,
      payload: {
        proposalId: proposal.id,
        sourceId: proposal.sourceId,
        kind: proposal.kind,
        outcome: 'accepted',
        ciId: result.ciId,
        reason: null,
      },
    });
    metrics.increment('discovery_proposals_decided_total', { outcome: 'accepted', kind: proposal.kind });
    return result;
  });

  await invalidateTraversals(ctx.tenantId);
  return outcome;
}

export async function rejectProposal(ctx: TenantContext, proposalId: string, reason: string) {
  authz.require(ctx, 'cmdb.manage');
  if (!reason.trim()) {
    // The reason is what stops the same suggestion coming back as a surprise,
    // and what tells the next person why the register disagrees with the feed.
    throw new ValidationError('say why; a rejection without one is a disagreement nobody can settle later');
  }

  return transaction(ctx, async (tx) => {
    const proposal = await load(tx, proposalId);
    const rejected = await tx.discoveryProposal.update({
      where: { id: proposal.id },
      data: { status: 'rejected', reason, decidedAt: new Date(), decidedBy: ctx.actor.id },
    });

    await recordAudit(tx, ctx, {
      action: 'discovery.proposal.rejected',
      targetType: 'discovery_proposal',
      targetId: proposal.id,
      after: { kind: proposal.kind, externalKey: proposal.externalKey, reason },
    });
    await publish(tx, ctx, {
      definition: events.discoveryProposalDecided,
      aggregateId: proposal.id,
      payload: {
        proposalId: proposal.id,
        sourceId: proposal.sourceId,
        kind: proposal.kind,
        outcome: 'rejected',
        ciId: proposal.ciId,
        reason,
      },
    });
    metrics.increment('discovery_proposals_decided_total', { outcome: 'rejected', kind: proposal.kind });
    return rejected;
  });
}

/**
 * Accepts everything pending from one source, of one kind.
 *
 * Deliberately narrow. "Accept all" over a mixed queue is how somebody clears
 * four hundred proposals at five o'clock and finds out in March what they
 * agreed to; restricted to one source and one kind, it is the reasonable
 * operation it sounds like — "yes, import the eighty laptops Intune found".
 * Bounded per call so the transaction stays a transaction.
 */
export async function acceptAll(
  ctx: TenantContext,
  input: { sourceKey: string; kind: 'create_ci' | 'update_ci' | 'create_relationship'; limit?: number },
) {
  authz.require(ctx, 'cmdb.manage');
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  const pending = await transaction(ctx, async (tx) => {
    const source = await tx.discoverySource.findFirst({ where: { key: input.sourceKey } });
    if (!source) throw new NotFoundError('discovery source', input.sourceKey);
    return tx.discoveryProposal.findMany({
      where: { sourceId: source.id, kind: input.kind, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
  });

  const accepted: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const row of pending) {
    try {
      await acceptProposal(ctx, row.id);
      accepted.push(row.id);
    } catch (error) {
      // One bad proposal must not stop the other seventy-nine — the same reason
      // one unreadable record does not lose a run.
      failed.push({ id: row.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { accepted: accepted.length, failed };
}

async function load(tx: Tx, proposalId: string) {
  const proposal = await tx.discoveryProposal.findFirst({ where: { id: proposalId } });
  if (!proposal) throw new NotFoundError('proposal', proposalId);
  if (proposal.status !== 'pending') {
    throw new ValidationError(`this proposal is already ${proposal.status}`);
  }
  return proposal;
}

async function apply(
  ctx: TenantContext,
  tx: Tx,
  proposal: {
    id: string;
    kind: string;
    externalKey: string;
    ciId: string | null;
    proposed: unknown;
    sourceId: string;
  },
): Promise<{ ciId: string; created: boolean }> {
  const proposed = (proposal.proposed ?? {}) as Record<string, unknown>;

  if (proposal.kind === 'create_relationship') {
    const fromCi = String(proposed.fromCi ?? '');
    const toCi = String(proposed.toCi ?? '');
    const type = String(proposed.type ?? '');
    assertRelationship(fromCi, toCi, type);

    const existing = await tx.ciRelationship.findFirst({ where: { fromCi, toCi, type } });
    if (!existing) {
      await tx.ciRelationship.create({
        data: { id: newId(), tenantId: ctx.tenantId, fromCi, toCi, type, createdBy: ctx.actor.id },
      });
    }
    return { ciId: fromCi, created: !existing };
  }

  if (proposal.kind === 'create_ci') {
    const classKey = String(proposed.classKey ?? '');
    const ciClass = await tx.ciClass.findFirst({ where: { key: classKey } });
    if (!ciClass) {
      throw new ValidationError(
        `this proposal is for the class ${classKey}, which does not exist; create the class, then accept it`,
      );
    }

    const attributes = (proposed.attributes ?? {}) as Record<string, unknown>;
    // Validated exactly as a person's entry would be. A source that could write
    // an attribute the class does not declare would be a way round E1's
    // validation, and a way round a rule is where the bad rows come from.
    assertAttributes(inheritedAttributes(await classChain(tx, ctx.tenantId, ciClass.id)), attributes);

    const clash = await tx.configurationItem.findFirst({ where: { externalKey: proposal.externalKey } });
    if (clash) {
      // Somebody created it by hand between the run and the decision. Treated
      // as already done rather than as an error: the outcome the person wanted
      // is the outcome they have.
      return { ciId: clash.id, created: false };
    }

    const id = newId();
    await tx.configurationItem.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        classId: ciClass.id,
        name: String(proposed.name ?? proposal.externalKey),
        externalKey: proposal.externalKey,
        ...(typeof proposed.description === 'string' ? { description: proposed.description } : {}),
        ...(typeof proposed.criticality === 'string' ? { criticality: proposed.criticality } : {}),
        ...(typeof proposed.environment === 'string' ? { environment: proposed.environment } : {}),
        attributes: attributes as never,
        source: 'discovery',
        lastSeenAt: new Date(),
        createdBy: ctx.actor.id,
      },
    });
    await publish(tx, ctx, {
      definition: events.ciRegistered,
      aggregateId: id,
      payload: {
        ciId: id,
        name: String(proposed.name ?? proposal.externalKey),
        classKey,
        criticality: typeof proposed.criticality === 'string' ? proposed.criticality : 'medium',
        serviceId: null,
        source: 'discovery',
      },
    });
    return { ciId: id, created: true };
  }

  // update_ci
  if (!proposal.ciId) throw new ValidationError('this proposal names no configuration item to update');
  const ci = await tx.configurationItem.findFirst({ where: { id: proposal.ciId } });
  if (!ci) throw new NotFoundError('configuration item', proposal.ciId);
  if (ci.retiredAt) throw new ValidationError('that configuration item is retired; nothing about it should change now');

  const { fields, attributes } = unflatten(proposed);
  const merged = { ...((ci.attributes ?? {}) as Record<string, unknown>), ...attributes };
  if (Object.keys(merged).length > 0) {
    assertAttributes(inheritedAttributes(await classChain(tx, ctx.tenantId, ci.classId)), merged);
  }

  await tx.configurationItem.update({
    where: { id: ci.id },
    data: {
      ...(typeof fields.name === 'string' ? { name: fields.name } : {}),
      ...(typeof fields.description === 'string' ? { description: fields.description } : {}),
      ...(typeof fields.criticality === 'string' ? { criticality: fields.criticality } : {}),
      ...(typeof fields.environment === 'string' ? { environment: fields.environment } : {}),
      ...(typeof fields.status === 'string' ? { status: fields.status } : {}),
      attributes: merged as never,
      lastSeenAt: new Date(),
      version: { increment: 1 },
    },
  });
  return { ciId: ci.id, created: false };
}
