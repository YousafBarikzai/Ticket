import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  publish,
  recordAudit,
  registerScopeResolver,
  transaction,
} from '@itsm/platform';
import { evaluate, parseDuration } from '@itsm/expr';
import { events } from '@itsm/contracts';
import {
  APPROVERS_NOT_YET_AVAILABLE,
  policyDefinitionSchema,
  resolveQuorum,
  settleStep,
  type Decision,
  type PolicyDefinition,
  type PolicyStep,
  type SubjectType,
} from '../domain/policy.js';
import { approverSlotFor, resolveApprovers } from './approver-resolver.js';

/**
 * MOD-17 approvals.
 *
 * A request is a pinned copy of a policy version plus the people it resolved to.
 * Steps open one at a time in sequence; the request settles as soon as a step
 * rejects, because an approval chain is a series of vetoes rather than a vote.
 */

// An approval is visible to the people it is for and the people who must decide.
registerScopeResolver<{ requestedBy: string | null; approverIds: string[] }>({
  aggregate: 'approval',
  isOwn: (ctx, request) =>
    Boolean(ctx.actor.id) &&
    (request.requestedBy === ctx.actor.id || request.approverIds.includes(ctx.actor.id!)),
  isTeam: () => false,
});

// ---------------------------------------------------------------------------
// Policy administration
// ---------------------------------------------------------------------------

export async function listPolicies(ctx: TenantContext, filter: { subjectType?: string } = {}) {
  authz.require(ctx, 'approval.policy.read');
  return transaction(ctx, (tx) =>
    tx.approvalPolicy.findMany({
      where: filter.subjectType ? { subjectType: filter.subjectType } : {},
      orderBy: [{ subjectType: 'asc' }, { specificity: 'desc' }],
    }),
  );
}

export async function createPolicy(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'approval.policy.manage');
  const definition = policyDefinitionSchema.parse(input);
  validatePolicy(definition);

  return transaction(ctx, async (tx) => {
    const existing = await tx.approvalPolicy.findFirst({ where: { key: definition.key } });
    if (existing) throw new ConflictError(`an approval policy with the key ${definition.key} already exists`);

    const policy = await tx.approvalPolicy.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        orgId: definition.orgId ?? null,
        key: definition.key,
        name: definition.name,
        description: definition.description ?? null,
        subjectType: definition.subjectType,
        match: definition.match as never,
        specificity: definition.specificity,
        steps: definition.steps as never,
        status: 'draft',
      },
    });
    await recordAudit(tx, ctx, {
      action: 'approval.policy.created',
      targetType: 'approval_policy',
      targetId: policy.id,
      after: { key: policy.key, subjectType: policy.subjectType },
    });
    return policy;
  });
}

export async function publishPolicy(ctx: TenantContext, idOrKey: string) {
  authz.require(ctx, 'approval.policy.manage');
  return transaction(ctx, async (tx) => {
    const policy = await loadPolicy(tx, idOrKey);
    validatePolicy({
      key: policy.key,
      name: policy.name,
      subjectType: policy.subjectType as SubjectType,
      match: policy.match as never,
      specificity: policy.specificity,
      steps: policy.steps as unknown as PolicyStep[],
    });

    const version = policy.version + 1;
    await tx.approvalPolicyVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        policyId: policy.id,
        version,
        snapshot: { steps: policy.steps, match: policy.match, name: policy.name } as never,
        publishedBy: ctx.actor.id,
      },
    });
    const published = await tx.approvalPolicy.update({
      where: { id: policy.id },
      data: { status: 'published', version, publishedAt: new Date(), publishedBy: ctx.actor.id },
    });
    await recordAudit(tx, ctx, {
      action: 'approval.policy.published',
      targetType: 'approval_policy',
      targetId: policy.id,
      before: { status: policy.status, version: policy.version },
      after: { status: 'published', version },
    });
    return published;
  });
}

// ---------------------------------------------------------------------------
// Requesting an approval
// ---------------------------------------------------------------------------

export interface RequestInput {
  subjectType: SubjectType;
  subjectId: string;
  ticketId?: string | null;
  /** The facts a policy's `match` and a step's `when` are evaluated against. */
  facts?: Record<string, unknown>;
  subjectUserId?: string | null;
  serviceId?: string | null;
}

/**
 * Opens an approval for a subject, if a published policy matches it.
 *
 * Returns null when no policy matches, which is not an error: most tickets need
 * no approval, and the caller carries on.
 */
export async function requestApproval(ctx: TenantContext, tx: Tx, input: RequestInput) {
  const facts = input.facts ?? {};
  const policies = await tx.approvalPolicy.findMany({
    where: { subjectType: input.subjectType, status: 'published' },
    orderBy: { specificity: 'desc' },
  });

  const matched = policies.find((policy) => {
    try {
      return evaluate(policy.match as never, facts);
    } catch {
      // A policy nobody can evaluate must not block every approval behind it.
      return false;
    }
  });
  if (!matched) return null;

  const existing = await tx.approvalRequest.findFirst({
    where: { subjectType: input.subjectType, subjectId: input.subjectId },
  });
  if (existing) return existing;

  const steps = matched.steps as unknown as PolicyStep[];
  const request = await tx.approvalRequest.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      policyId: matched.id,
      policyVersion: matched.version,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ticketId: input.ticketId ?? null,
      status: 'pending',
      requestedBy: ctx.actor.id,
    },
  });

  for (const [index, step] of steps.entries()) {
    await tx.approvalStep.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        requestId: request.id,
        sequence: index + 1,
        name: step.name,
        quorum: typeof step.quorum === 'number' ? step.quorum : 0,
        approverIds: [],
        status: 'waiting',
        onTimeout: step.onTimeout,
      },
    });
  }

  await openNextStep(ctx, tx, request.id, {
    subjectUserId: input.subjectUserId ?? null,
    serviceId: input.serviceId ?? null,
    facts,
  });

  await recordAudit(tx, ctx, {
    action: 'approval.requested',
    targetType: 'approval_request',
    targetId: request.id,
    after: { policyKey: matched.key, policyVersion: matched.version, subjectType: input.subjectType },
  });
  await publish(tx, ctx, {
    definition: events.approvalRequested,
    aggregateId: request.id,
    payload: {
      requestId: request.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ticketId: input.ticketId ?? null,
      policyKey: matched.key,
    },
  });

  return tx.approvalRequest.findFirst({ where: { id: request.id } });
}

interface OpenContext {
  subjectUserId: string | null;
  serviceId: string | null;
  facts: Record<string, unknown>;
}

/**
 * Opens the next waiting step, resolving its approvers now rather than when the
 * policy was written.
 *
 * A step whose `when` does not hold is skipped, and a step that resolves to
 * nobody is skipped too — with a reason recorded. Blocking forever on an empty
 * step is the failure mode that turns an approval policy into an outage.
 */
export async function openNextStep(ctx: TenantContext, tx: Tx, requestId: string, open: OpenContext): Promise<void> {
  const request = await tx.approvalRequest.findFirst({ where: { id: requestId } });
  if (!request || request.status !== 'pending') return;

  const policy = await tx.approvalPolicy.findFirst({ where: { id: request.policyId } });
  const definitions = (policy?.steps ?? []) as unknown as PolicyStep[];
  const steps = await tx.approvalStep.findMany({ where: { requestId }, orderBy: { sequence: 'asc' } });

  for (const step of steps) {
    if (step.status !== 'waiting') continue;
    const definition = definitions[step.sequence - 1];
    if (!definition) continue;

    if (definition.when) {
      let applies = true;
      try {
        applies = evaluate(definition.when as never, open.facts);
      } catch {
        applies = false;
      }
      if (!applies) {
        await tx.approvalStep.update({
          where: { id: step.id },
          data: { status: 'skipped', decidedAt: new Date() },
        });
        continue;
      }
    }

    const resolved = await resolveApprovers(tx, ctx, definition.approvers, {
      subjectUserId: open.subjectUserId,
      serviceId: open.serviceId,
    });

    if (resolved.approverIds.length === 0) {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: 'skipped', decidedAt: new Date() },
      });
      await recordAudit(tx, ctx, {
        action: 'approval.step.skipped',
        targetType: 'approval_step',
        targetId: step.id,
        after: { reason: 'no approver could be resolved', explanation: resolved.explanation },
      });
      continue;
    }

    const dueAt = definition.timeout ? new Date(Date.now() + parseDuration(definition.timeout)) : null;
    await tx.approvalStep.update({
      where: { id: step.id },
      data: {
        status: 'open',
        approverIds: resolved.approverIds,
        quorum: resolveQuorum(definition.quorum, resolved.approverIds.length),
        openedAt: new Date(),
        dueAt,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'approval.step.opened',
      targetType: 'approval_step',
      targetId: step.id,
      after: { approvers: resolved.approverIds.length, explanation: resolved.explanation },
    });
    return;
  }

  // Every step is settled or skipped, so the request is settled too.
  await settleRequest(ctx, tx, requestId, 'approved');
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(2000).optional(),
});

export async function decide(
  ctx: TenantContext,
  requestId: string,
  input: { decision: Decision; comment?: string; via?: string },
) {
  return transaction(ctx, async (tx) => {
    const request = await tx.approvalRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundError('approval not found');
    if (request.status !== 'pending') throw new ConflictError('this approval has already been decided');

    const step = await tx.approvalStep.findFirst({ where: { requestId, status: 'open' } });
    if (!step) throw new ConflictError('this approval has no open step');

    const userId = ctx.actor.id;
    if (!userId) throw new ForbiddenError('approval.decide', 'only a person can decide an approval');

    const slot = await approverSlotFor(tx, step.approverIds, userId);
    // 404, not 403: whether a given person is an approver is itself information.
    if (!slot) throw new NotFoundError('approval not found');

    const already = await tx.approvalDecision.findFirst({ where: { stepId: step.id, approverId: slot.approverId } });
    if (already) throw new ConflictError('this approver has already decided');

    await tx.approvalDecision.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        stepId: step.id,
        approverId: slot.approverId,
        actedById: slot.actedById,
        decision: input.decision,
        comment: input.comment ?? null,
        via: input.via ?? 'api',
      },
    });

    const decisions = await tx.approvalDecision.findMany({ where: { stepId: step.id } });
    const outcome = settleStep(step.quorum, step.approverIds.length, decisions);

    await recordAudit(tx, ctx, {
      action: 'approval.decided',
      targetType: 'approval_step',
      targetId: step.id,
      after: {
        decision: input.decision,
        approverId: slot.approverId,
        actedById: slot.actedById,
        stepStatus: outcome.status,
      },
      reason: input.comment ?? null,
    });

    if (outcome.status === 'waiting') {
      return { requestStatus: 'pending' as const, stepStatus: 'open' as const };
    }

    await tx.approvalStep.update({
      where: { id: step.id },
      data: { status: outcome.status, decidedAt: new Date() },
    });

    if (outcome.status === 'rejected') {
      await settleRequest(ctx, tx, requestId, 'rejected');
      return { requestStatus: 'rejected' as const, stepStatus: 'rejected' as const };
    }

    const subject = await subjectContextFor(tx, request);
    await openNextStep(ctx, tx, requestId, subject);
    const after = await tx.approvalRequest.findFirst({ where: { id: requestId } });
    return { requestStatus: (after?.status ?? 'pending') as 'pending' | 'approved' | 'rejected', stepStatus: 'approved' as const };
  });
}

async function settleRequest(ctx: TenantContext, tx: Tx, requestId: string, outcome: 'approved' | 'rejected') {
  const request = await tx.approvalRequest.findFirst({ where: { id: requestId } });
  if (!request || request.status !== 'pending') return;

  await tx.approvalRequest.update({
    where: { id: requestId },
    data: { status: outcome, outcome, decidedAt: new Date() },
  });
  await recordAudit(tx, ctx, {
    action: `approval.${outcome}`,
    targetType: 'approval_request',
    targetId: requestId,
    before: { status: 'pending' },
    after: { status: outcome },
  });
  await publish(tx, ctx, {
    definition: events.approvalDecided,
    aggregateId: requestId,
    payload: {
      requestId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      ticketId: request.ticketId,
      outcome,
    },
  });
}

async function subjectContextFor(tx: Tx, request: { ticketId: string | null }): Promise<OpenContext> {
  if (!request.ticketId) return { subjectUserId: null, serviceId: null, facts: {} };
  const ticket = await tx.ticket.findFirst({ where: { id: request.ticketId } });
  return {
    subjectUserId: ticket?.requesterId ?? null,
    serviceId: ticket?.serviceId ?? null,
    facts: { ticket: ticket ?? {} },
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listMyApprovals(ctx: TenantContext, options: { includeDecided?: boolean } = {}) {
  authz.require(ctx, 'approval.read');
  const userId = ctx.actor.id;
  if (!userId) return [];

  return transaction(ctx, async (tx) => {
    const steps = await tx.approvalStep.findMany({
      where: { approverIds: { has: userId }, ...(options.includeDecided ? {} : { status: 'open' }) },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    const requestIds = [...new Set(steps.map((step) => step.requestId))];
    if (requestIds.length === 0) return [];
    return tx.approvalRequest.findMany({ where: { id: { in: requestIds } }, orderBy: { requestedAt: 'desc' } });
  });
}

export async function getApproval(ctx: TenantContext, requestId: string) {
  authz.require(ctx, 'approval.read');
  return transaction(ctx, async (tx) => {
    const request = await tx.approvalRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundError('approval not found');

    const steps = await tx.approvalStep.findMany({ where: { requestId }, orderBy: { sequence: 'asc' } });
    const decisions = await tx.approvalDecision.findMany({
      where: { stepId: { in: steps.map((step) => step.id) } },
    });

    // The people this approval is for or about may read it; anyone else must
    // hold the tenant-wide permission, and gets a 404 rather than a 403.
    const approverIds = steps.flatMap((step) => step.approverIds);
    if (!ctx.permissions.has('approval.read', 'any')) {
      const mine = request.requestedBy === ctx.actor.id || (ctx.actor.id && approverIds.includes(ctx.actor.id));
      if (!mine) throw new NotFoundError('approval not found');
    }

    return {
      ...request,
      steps: steps.map((step) => ({
        ...step,
        decisions: decisions.filter((decision) => decision.stepId === step.id),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

export const delegationSchema = z.object({
  toUserId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: z.string().max(500).optional(),
});

export async function createDelegation(ctx: TenantContext, input: unknown, fromUserId?: string) {
  const parsed = delegationSchema.parse(input);
  const from = fromUserId ?? ctx.actor.id;
  if (!from) throw new ForbiddenError('approval.delegate', 'only a person can delegate their approvals');
  // Delegating someone else's approvals is an administrative act, not a personal one.
  if (fromUserId && fromUserId !== ctx.actor.id) authz.require(ctx, 'approval.policy.manage');

  if (parsed.toUserId === from) throw new ValidationError('an approver cannot delegate to themselves');
  if (new Date(parsed.endsAt) <= new Date(parsed.startsAt)) {
    throw new ValidationError('a delegation must end after it starts');
  }

  return transaction(ctx, async (tx) => {
    const delegation = await tx.approvalDelegation.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        fromUserId: from,
        toUserId: parsed.toUserId,
        reason: parsed.reason ?? null,
        startsAt: new Date(parsed.startsAt),
        endsAt: new Date(parsed.endsAt),
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'approval.delegated',
      targetType: 'approval_delegation',
      targetId: delegation.id,
      after: { fromUserId: from, toUserId: parsed.toUserId, startsAt: parsed.startsAt, endsAt: parsed.endsAt },
    });
    return delegation;
  });
}

// ---------------------------------------------------------------------------

async function loadPolicy(tx: Tx, idOrKey: string) {
  const policy = await tx.approvalPolicy.findFirst({
    where: /^[0-9a-f-]{36}$/i.test(idOrKey) ? { id: idOrKey } : { key: idOrKey },
  });
  if (!policy) throw new NotFoundError('approval policy not found');
  return policy;
}

/** Refuses a policy that cannot do what its author expects. */
export function validatePolicy(definition: Pick<PolicyDefinition, 'steps'> & Partial<PolicyDefinition>): void {
  const unavailable = definition.steps
    .flatMap((step) => step.approvers.map((approver) => approver.kind))
    .filter((kind) => kind in APPROVERS_NOT_YET_AVAILABLE)
    .map((kind) => `${kind} (arrives with ${APPROVERS_NOT_YET_AVAILABLE[kind]})`);

  if (unavailable.length > 0) {
    throw new ValidationError(
      `this policy names approvers that cannot be resolved yet: ${[...new Set(unavailable)].join(', ')}`,
      [...new Set(unavailable)].map((what) => ({ field: 'steps', code: 'not_yet_available', message: what })),
    );
  }
}
