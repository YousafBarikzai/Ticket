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
import { describeRequest, describeRequests } from './approval-context.js';

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
 * When an approval step happened, for a history written after the fact (the
 * shared demo's four months, A4 §2.3). Omitted, the present — exactly what
 * every live caller has always recorded.
 */
export interface ApprovalClock {
  at?: Date;
}

/**
 * Opens an approval for a subject, if a published policy matches it.
 *
 * Returns null when no policy matches, which is not an error: most tickets need
 * no approval, and the caller carries on.
 *
 * `at` dates the request, its first step's opening and that step's due time,
 * so an approval imported with its ticket's history is due when it was due
 * then, not two days after the import ran.
 */
export async function requestApproval(ctx: TenantContext, tx: Tx, input: RequestInput, clock: ApprovalClock = {}) {
  const at = clock.at === undefined ? undefined : pastInstant(clock.at);
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
      ...(at ? { requestedAt: at } : {}),
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

  await openNextStep(
    ctx,
    tx,
    request.id,
    {
      subjectUserId: input.subjectUserId ?? null,
      serviceId: input.serviceId ?? null,
      facts,
    },
    at,
  );

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
 *
 * `at` is when this happens: the step's opening, its due time and any skip
 * are stamped with it. Omitted, the present.
 */
export async function openNextStep(
  ctx: TenantContext,
  tx: Tx,
  requestId: string,
  open: OpenContext,
  at: Date = new Date(),
): Promise<void> {
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
          data: { status: 'skipped', decidedAt: at },
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
        data: { status: 'skipped', decidedAt: at },
      });
      await recordAudit(tx, ctx, {
        action: 'approval.step.skipped',
        targetType: 'approval_step',
        targetId: step.id,
        after: { reason: 'no approver could be resolved', explanation: resolved.explanation },
      });
      continue;
    }

    const dueAt = definition.timeout ? new Date(at.getTime() + parseDuration(definition.timeout)) : null;
    await tx.approvalStep.update({
      where: { id: step.id },
      data: {
        status: 'open',
        approverIds: resolved.approverIds,
        quorum: resolveQuorum(definition.quorum, resolved.approverIds.length),
        openedAt: at,
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
  await settleRequest(ctx, tx, requestId, 'approved', at);
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(2000).optional(),
});

/**
 * Records one approver's decision and settles what it settles.
 *
 * `at` dates the decision, the step and request it settles, and the next step
 * it opens; it cannot come before the step opened, because nobody decides a
 * question before it is put to them. Omitted, the present.
 */
export async function decide(
  ctx: TenantContext,
  requestId: string,
  input: { decision: Decision; comment?: string; via?: string },
  clock: ApprovalClock = {},
) {
  const at = clock.at === undefined ? undefined : pastInstant(clock.at);
  return transaction(ctx, async (tx) => {
    const request = await tx.approvalRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundError('approval not found');
    if (request.status !== 'pending') throw await settledConflict(tx, request);

    const step = await tx.approvalStep.findFirst({ where: { requestId, status: 'open' } });
    if (!step) throw new ConflictError('this approval has no open step');

    const userId = ctx.actor.id;
    if (!userId) throw new ForbiddenError('approval.decide', 'only a person can decide an approval');

    const slot = await approverSlotFor(tx, step.approverIds, userId);
    // 404, not 403: whether a given person is an approver is itself information.
    if (!slot) throw new NotFoundError('approval not found');

    // Checked once the caller is known to be an approver, so the step's
    // opening time is told only to somebody it was put to.
    if (at && step.openedAt && at < step.openedAt) {
      throw new ValidationError('a decision cannot come before its step was opened', [
        { field: 'at', code: 'before_opened', message: `the step opened at ${step.openedAt.toISOString()}` },
      ]);
    }

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
        ...(at ? { decidedAt: at } : {}),
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

    // Conditional on the step still being open. A step settled by another
    // transaction since it was read — a second approver reaching the quorum
    // first, or the ticket ending and withdrawing the approval — refuses this
    // decision rather than writing over that outcome.
    const settled = await tx.approvalStep.updateMany({
      where: { id: step.id, status: 'open' },
      data: { status: outcome.status, decidedAt: at ?? new Date() },
    });
    if (settled.count === 0) {
      const current = await tx.approvalRequest.findFirst({ where: { id: requestId } });
      throw await settledConflict(tx, current ?? request);
    }

    if (outcome.status === 'rejected') {
      await settleRequest(ctx, tx, requestId, 'rejected', at);
      return { requestStatus: 'rejected' as const, stepStatus: 'rejected' as const };
    }

    const subject = await subjectContextFor(tx, request);
    await openNextStep(ctx, tx, requestId, subject, at);
    const after = await tx.approvalRequest.findFirst({ where: { id: requestId } });
    return { requestStatus: (after?.status ?? 'pending') as 'pending' | 'approved' | 'rejected', stepStatus: 'approved' as const };
  });
}

async function settleRequest(
  ctx: TenantContext,
  tx: Tx,
  requestId: string,
  outcome: 'approved' | 'rejected',
  at: Date = new Date(),
) {
  const request = await tx.approvalRequest.findFirst({ where: { id: requestId } });
  if (!request || request.status !== 'pending') return;

  await tx.approvalRequest.update({
    where: { id: requestId },
    data: { status: outcome, outcome, decidedAt: at },
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

// ---------------------------------------------------------------------------
// Withdrawing (ADR-0059)
// ---------------------------------------------------------------------------

/** The outcome of an approval nobody decided because its ticket ended first. */
export const WITHDRAWN = 'withdrawn';

/** Why an approval was withdrawn: how the ticket it waited on ended. */
export const WITHDRAWAL_REASONS = ['ticket-cancelled', 'ticket-closed'] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

/**
 * The withdrawal a ticket's new status calls for, if any.
 *
 * Only the two ends a ticket cannot come back from. `resolved` withdraws
 * nothing: the requester can still reopen it, and an approval withdrawn then
 * would have to be asked for all over again.
 */
export function withdrawalReasonFor(status: string): WithdrawalReason | null {
  if (status === 'cancelled') return 'ticket-cancelled';
  if (status === 'closed') return 'ticket-closed';
  return null;
}

/**
 * What an approver reads when they try to decide an approval that was
 * withdrawn. Its own sentence rather than "already decided", because nobody
 * decided it: the request it was for went away, and the approver should know
 * there is nothing left to chase.
 */
export function withdrawnSentence(reason: WithdrawalReason): string {
  return reason === 'ticket-closed'
    ? 'This approval was withdrawn because its ticket was closed'
    : 'This approval was withdrawn because its ticket was cancelled';
}

/**
 * Withdraws every approval still waiting on a ticket that has ended.
 *
 * Without this a cancelled request keeps a pending approval, and its approver
 * keeps being asked to decide something nobody wants any more: a phantom in
 * their list, the portal badge and the Help Portal Home. The request settles as
 * `cancelled` with the outcome `withdrawn`, so nothing reads it as a decision,
 * and every step still waiting, open or blocked ends with it (a blocked step is
 * an open one that lost its approvers, and must not stay flagged on a request
 * that no longer needs it). An approval that was already decided is history and
 * is left exactly as it is.
 *
 * `at` is when the ticket ended rather than when this ran, so a delivery the
 * reconciler retried later still records the right moment — never earlier than
 * the request itself, so its duration cannot come out negative.
 */
export async function withdrawForTicket(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  reason: WithdrawalReason,
  at: Date = new Date(),
): Promise<{ withdrawn: string[] }> {
  const pending = await tx.approvalRequest.findMany({
    where: { ticketId, status: 'pending' },
    orderBy: { requestedAt: 'asc' },
  });

  const withdrawn: string[] = [];
  for (const request of pending) {
    const decidedAt = at < request.requestedAt ? request.requestedAt : at;
    // Conditional on still being pending: a decision that settled the request
    // in another transaction wins, and this leaves it alone.
    const settled = await tx.approvalRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: { status: 'cancelled', outcome: WITHDRAWN, decidedAt },
    });
    if (settled.count === 0) continue;

    await tx.approvalStep.updateMany({
      where: { requestId: request.id, status: { in: ['waiting', 'open', 'blocked'] } },
      data: { status: 'cancelled', decidedAt },
    });
    await recordAudit(tx, ctx, {
      action: 'approval.withdrawn',
      targetType: 'approval_request',
      targetId: request.id,
      before: { status: 'pending' },
      after: { status: 'cancelled', reason },
    });
    await publish(tx, ctx, {
      definition: events.approvalCancelled,
      aggregateId: request.id,
      payload: {
        requestId: request.id,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        ticketId: request.ticketId,
        reason,
      },
    });
    withdrawn.push(request.id);
  }
  return { withdrawn };
}

/**
 * The 409 for deciding an approval that is no longer waiting on anybody:
 * "already decided", or the withdrawn sentence when nobody decided it at all.
 */
async function settledConflict(
  tx: Tx,
  request: { outcome: string | null; ticketId: string | null },
): Promise<ConflictError> {
  if (request.outcome !== WITHDRAWN) return new ConflictError('this approval has already been decided');
  return new ConflictError(withdrawnSentence(await withdrawalReasonOf(tx, request)));
}

/**
 * How a withdrawn approval's ticket ended, read from the ticket: a closed
 * ticket stays closed, so it is a fact rather than a guess. Anything else —
 * including a ticket that has since gone — reads as cancelled, the common case.
 */
async function withdrawalReasonOf(tx: Tx, request: { ticketId: string | null }): Promise<WithdrawalReason> {
  if (!request.ticketId) return 'ticket-cancelled';
  const ticket = await tx.ticket.findFirst({ where: { id: request.ticketId }, select: { status: true } });
  return ticket?.status === 'closed' ? 'ticket-closed' : 'ticket-cancelled';
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

/**
 * What is waiting on me: the approvals I am named on, with their progress and
 * what each one is about (approval-context.ts).
 */
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
    const requests = await tx.approvalRequest.findMany({
      where: { id: { in: requestIds } },
      orderBy: { requestedAt: 'desc' },
    });
    return describeRequests(tx, userId, requests);
  });
}

/**
 * The approvals on one ticket, for the person the ticket is for: how far their
 * request has got ("Step 1 of 2 · Line manager · due Friday").
 *
 * Only the ticket's requester or the person it affects — the people the portal
 * shows it to — or a reader holding `approval.read` at `any`. Anybody else gets
 * an empty list, the same answer as a ticket with no approvals, so the parameter
 * cannot be used to learn which of other people's tickets are waiting on a
 * decision. An agent working the ticket is deliberately not included: approvals
 * are not part of the workbench, and reading a ticket is not the same as being
 * party to the decisions about it.
 *
 * The rows carry progress only. The subject and answers stay with approvers
 * (approval-context.ts), and nobody approves their own request.
 */
export async function listApprovalsForTicket(
  ctx: TenantContext,
  ticketId: string,
  options: { includeDecided?: boolean } = {},
) {
  authz.require(ctx, 'approval.read');
  const userId = ctx.actor.id;

  return transaction(ctx, async (tx) => {
    if (!ctx.permissions.has('approval.read', 'any')) {
      if (!userId) return [];
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, deletedAt: null },
        select: { requesterId: true, affectedUserId: true },
      });
      if (!ticket || (ticket.requesterId !== userId && ticket.affectedUserId !== userId)) return [];
    }

    const requests = await tx.approvalRequest.findMany({
      where: { ticketId, ...(options.includeDecided ? {} : { status: 'pending' }) },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
    return describeRequests(tx, userId, requests);
  });
}

/**
 * One approval with its steps and decisions, its progress, and — for the
 * people named as its approvers — the subject and the catalogue answers.
 */
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
      ...(await describeRequest(tx, ctx.actor.id, request)),
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

/**
 * A supplied clock, once it is known to be a real instant that has already
 * happened. A history records the past; an approval dated after now would be
 * due, decided or overdue at a moment nobody has reached yet.
 */
function pastInstant(at: Date): Date {
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError('the time given is not a date', [{ field: 'at', code: 'invalid', message: 'not a date' }]);
  }
  if (at.getTime() > Date.now()) {
    throw new ValidationError('an approval cannot be dated in the future', [
      { field: 'at', code: 'in_future', message: 'must not be later than now' },
    ]);
  }
  return at;
}

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
