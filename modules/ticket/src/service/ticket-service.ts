import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionRequiredError,
  ValidationError,
  authz,
  newId,
  nextNumber,
  publish,
  recordAudit,
  registerScopeResolver,
  transaction,
  presignUpload,
  MAX_ATTACHMENT_BYTES,
  publishNotice,
  topicForEntity,
  topicForUser,
  getSetting,
  enqueue,
} from '@itsm/platform';
import {
  events,
  numberPrefix,
  type CanonicalState,
  type TicketType,
  inverseLinkType,
  type LinkType,
} from '@itsm/contracts';
import {
  assertTransition,
  canTransition,
  categoryOf,
  effectsOf,
  isRequesterTransition,
  requiresAdministratorOverride,
  STATES,
} from '../domain/state-machine.js';
import * as repo from '../repo/ticket-repo.js';

/**
 * MOD-04 ticket service.
 *
 * Every mutating method follows the same shape, which is the module contract in
 * one place: open a transaction, check permission against the loaded record,
 * write the row, write the audit event and write the outbox event — all or
 * nothing (docs/architecture/04 §3).
 */

// ---------------------------------------------------------------------------
// Scope resolution: how "own" and "team" apply to a ticket. Registered here
// because only this module knows which of its columns mean those things.
// ---------------------------------------------------------------------------
registerScopeResolver<repo.TicketRow>({
  aggregate: 'ticket',
  isOwn: (ctx, ticket) =>
    Boolean(ctx.actor.id) &&
    (ticket.requesterId === ctx.actor.id || ticket.affectedUserId === ctx.actor.id || ticket.assigneeId === ctx.actor.id),
  isTeam: (ctx, ticket) => {
    if (ticket.groupId) return ctx.teamIds.includes(ticket.groupId);
    // A ticket that no rule has routed yet belongs to its organisation's triage
    // pool: without this, a newly raised ticket would be invisible to every
    // agent and could never be picked up.
    return Boolean(ticket.orgId && ctx.organisationIds.includes(ticket.orgId));
  },
  orgId: (ticket) => ticket.orgId,
});

export const createTicketSchema = z.object({
  type: z.enum(['incident', 'request', 'problem', 'change', 'task', 'question']).default('incident'),
  title: z.string().min(1).max(500),
  description: z.string().max(100_000).optional(),
  descriptionFormat: z.enum(['text', 'html']).default('text'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  impact: z.enum(['high', 'medium', 'low']).optional(),
  urgency: z.enum(['high', 'medium', 'low']).optional(),
  requesterId: z.string().uuid().optional(),
  affectedUserId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  sourceChannel: z.enum(['portal', 'email', 'api', 'slack', 'teams', 'whatsapp', 'voice', 'mobile', 'import', 'system']).default('api'),
  channelRef: z.string().max(500).optional(),
  externalRef: z.string().max(200).optional(),
  custom: z.record(z.unknown()).default({}),
});
/** The caller supplies what they know; the schema fills in the defaults. */
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(100_000).nullable(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']),
    impact: z.enum(['high', 'medium', 'low']).nullable(),
    urgency: z.enum(['high', 'medium', 'low']).nullable(),
    serviceId: z.string().uuid().nullable(),
    categoryId: z.string().uuid().nullable(),
    affectedUserId: z.string().uuid().nullable(),
    custom: z.record(z.unknown()),
  })
  .partial();
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

const MUTABLE_FIELDS = ['title', 'description', 'priority', 'impact', 'urgency', 'serviceId', 'categoryId', 'affectedUserId', 'custom'] as const;

/** Derives priority from the impact/urgency matrix, per specification §11.3. */
export async function derivePriority(tx: Tx, ctx: TenantContext, impact?: string | null, urgency?: string | null): Promise<string | undefined> {
  if (!impact || !urgency) return undefined;
  const row = await tx.priorityMatrix.findFirst({
    where: { impact, urgency, OR: [{ orgId: { in: ctx.organisationIds } }, { orgId: null }] },
    orderBy: { orgId: 'desc' },
  });
  return row?.priority;
}

export async function createTicket(ctx: TenantContext, input: CreateTicketInput): Promise<repo.TicketRow> {
  const parsed = createTicketSchema.parse(input);
  authz.require(ctx, 'ticket.create');

  // A requester with only "own" scope may raise a ticket for themselves.
  const requesterId = parsed.requesterId ?? ctx.actor.id;
  if (parsed.requesterId && parsed.requesterId !== ctx.actor.id && !ctx.permissions.has('ticket.create', 'any')) {
    throw new ForbiddenError('ticket.create', 'raising a ticket on behalf of someone else needs tenant-wide permission');
  }

  return transaction(ctx, async (tx) => {
    const type = parsed.type as TicketType;
    const number = await nextNumber(tx, ctx, type, numberPrefix[type]);
    const status: CanonicalState = 'new';

    const derived = await derivePriority(tx, ctx, parsed.impact, parsed.urgency);
    const priority = parsed.priority ?? derived ?? (await getSetting<string>(ctx, 'ticket.defaultPriority'));

    const id = newId();
    const ticket = await repo.insertTicket(tx, {
      id,
      tenantId: ctx.tenantId,
      orgId: parsed.orgId ?? ctx.organisationIds[0] ?? null,
      number,
      type,
      title: parsed.title,
      description: parsed.description ?? null,
      descriptionFormat: parsed.descriptionFormat,
      status,
      statusCategory: categoryOf(status),
      priority,
      impact: parsed.impact ?? null,
      urgency: parsed.urgency ?? null,
      requesterId: requesterId ?? null,
      affectedUserId: parsed.affectedUserId ?? requesterId ?? null,
      assigneeId: parsed.assigneeId ?? null,
      groupId: parsed.groupId ?? null,
      serviceId: parsed.serviceId ?? null,
      categoryId: parsed.categoryId ?? null,
      sourceChannel: parsed.sourceChannel,
      channelRef: parsed.channelRef ?? null,
      parentId: parsed.parentId ?? null,
      externalRef: parsed.externalRef ?? null,
      custom: parsed.custom as never,
      createdBy: ctx.actor.id,
      createdByType: ctx.actor.type,
      updatedBy: ctx.actor.id,
    });

    await repo.insertTicketEvent(tx, ctx, id, 'created', { number, channel: parsed.sourceChannel });

    if (requesterId) {
      await tx.ticketWatcher.create({
        data: { id: newId(), tenantId: ctx.tenantId, ticketId: id, userId: requesterId, reason: 'requester' },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'ticket.created',
      targetType: 'ticket',
      targetId: id,
      after: { number, type, title: parsed.title, status, priority },
    });

    await publish(tx, ctx, {
      definition: events.ticketCreated,
      aggregateId: id,
      aggregateVersion: ticket.version,
      payload: {
        ticketId: id,
        number,
        type,
        channel: parsed.sourceChannel,
        requesterId: requesterId ?? null,
        priority,
        serviceId: parsed.serviceId ?? null,
        categoryId: parsed.categoryId ?? null,
        groupId: parsed.groupId ?? null,
        orgId: ticket.orgId,
      },
    });

    return ticket;
  });
}

/** Loads a ticket and checks the caller may see it, raising 404 if not. */
export async function getTicket(ctx: TenantContext, idOrNumber: string): Promise<repo.TicketRow> {
  return transaction(ctx, async (tx) => loadVisible(tx, ctx, idOrNumber));
}

async function loadVisible(tx: Tx, ctx: TenantContext, idOrNumber: string): Promise<repo.TicketRow> {
  const ticket = await repo.findByIdOrNumber(tx, idOrNumber);
  if (!ticket) throw new NotFoundError('ticket', idOrNumber);
  authz.requireVisible(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket }, 'ticket');
  return ticket;
}

export interface ListResult {
  data: repo.TicketRow[];
  nextCursor: string | null;
}

export async function listTickets(
  ctx: TenantContext,
  filter: repo.ListFilter,
  options: { limit: number; cursor?: string; sort?: repo.ListOptions['sort'] },
): Promise<ListResult> {
  authz.require(ctx, 'ticket.read');
  const scope = scopeFilterFor(ctx);

  return transaction(ctx, async (tx) => {
    const sort = options.sort ?? '-createdAt';
    const cursor = decodeCursor(options.cursor);
    const rows = await repo.listTickets(tx, filter, {
      limit: options.limit + 1,
      sort,
      ...(cursor ? { cursor } : {}),
      ...(scope ? { scope } : {}),
    });

    const hasMore = rows.length > options.limit;
    const data = hasMore ? rows.slice(0, options.limit) : rows;
    const last = data.at(-1);
    return {
      data,
      nextCursor: hasMore && last ? encodeCursor(sort.includes('due') ? last.dueAt ?? last.createdAt : last.createdAt, last.id) : null,
    };
  });
}

/**
 * Turns the caller's permission scope into a SQL predicate, so a list query
 * filters in the database rather than loading rows and discarding them.
 */
function scopeFilterFor(ctx: TenantContext): Record<string, unknown> | undefined {
  const scope = authz.effectiveScope(ctx, 'ticket.read');
  if (scope === 'any') return undefined;
  if (scope === 'team') {
    return {
      OR: [
        { groupId: { in: ctx.teamIds } },
        { requesterId: ctx.actor.id },
        { affectedUserId: ctx.actor.id },
        { assigneeId: ctx.actor.id },
        // The unrouted triage pool, scoped to the actor's organisations.
        ...(ctx.organisationIds.length ? [{ groupId: null, orgId: { in: ctx.organisationIds } }] : []),
      ],
    };
  }
  return {
    OR: [{ requesterId: ctx.actor.id }, { affectedUserId: ctx.actor.id }, { assigneeId: ctx.actor.id }],
  };
}

function encodeCursor(value: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: value.toISOString(), id })).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v: string; id: string };
    return { createdAt: new Date(parsed.v), id: parsed.id };
  } catch {
    throw new ValidationError('cursor is not valid', [{ field: 'cursor', code: 'invalid', message: 'unreadable cursor' }]);
  }
}

export async function updateTicket(
  ctx: TenantContext,
  idOrNumber: string,
  patch: UpdateTicketInput,
  ifMatch: number | undefined,
): Promise<repo.TicketRow> {
  const parsed = updateTicketSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ValidationError('no fields to update');

  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.update', { aggregate: 'ticket', record: ticket });
    requireIfMatch(ifMatch, ticket.version);

    const changed: Record<string, { before: unknown; after: unknown }> = {};
    const data: Record<string, unknown> = {};
    for (const field of MUTABLE_FIELDS) {
      if (!(field in parsed)) continue;
      const after = (parsed as Record<string, unknown>)[field];
      const before = (ticket as unknown as Record<string, unknown>)[field];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changed[field] = { before, after };
      data[field] = after;
    }
    if (Object.keys(changed).length === 0) return ticket;

    // Changing impact or urgency re-derives priority unless it was set explicitly.
    if ((changed.impact || changed.urgency) && !changed.priority) {
      const impact = (parsed.impact ?? ticket.impact) as string | null;
      const urgency = (parsed.urgency ?? ticket.urgency) as string | null;
      const derived = await derivePriority(tx, ctx, impact, urgency);
      if (derived && derived !== ticket.priority) {
        changed.priority = { before: ticket.priority, after: derived };
        data.priority = derived;
      }
    }

    data.updatedBy = ctx.actor.id;
    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, data as never);
    if (affected === 0) throw new ConflictError('this ticket changed while you were editing it', ticket);

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'updated', { changed });
    await recordAudit(tx, ctx, {
      action: 'ticket.updated',
      targetType: 'ticket',
      targetId: ticket.id,
      before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.before])),
      after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.after])),
    });
    await publish(tx, ctx, {
      definition: events.ticketUpdated,
      aggregateId: ticket.id,
      aggregateVersion: ticket.version + 1,
      payload: { ticketId: ticket.id, number: ticket.number, changed },
    });

    const updated = (await repo.findById(tx, ticket.id))!;
    await notifyChange(ctx, updated, 'updated');
    return updated;
  });
}

function requireIfMatch(ifMatch: number | undefined, current: number): void {
  if (ifMatch === undefined) throw new PreconditionRequiredError();
  if (ifMatch !== current) {
    throw new ConflictError(`this ticket is at version ${current}; you sent ${ifMatch}`);
  }
}

export async function transitionTicket(
  ctx: TenantContext,
  idOrNumber: string,
  to: CanonicalState,
  options: { reason?: string; ifMatch?: number; resolutionCode?: string } = {},
): Promise<repo.TicketRow> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const from = ticket.status as CanonicalState;

    authz.require(ctx, 'ticket.transition', { aggregate: 'ticket', record: ticket });

    // A requester may only make the moves the state machine marks as theirs.
    const actingAsRequester =
      !ctx.permissions.has('ticket.transition', 'team') && !ctx.permissions.has('ticket.transition', 'any');
    if (actingAsRequester && !isRequesterTransition(from, to)) {
      throw new ForbiddenError('ticket.transition', `a requester cannot move a ticket from ${from} to ${to}`);
    }
    if (requiresAdministratorOverride(from) && !ctx.permissions.has('ticket.update', 'any')) {
      throw new ForbiddenError('ticket.update', `${from} tickets can only be changed by an administrator, with a reason`);
    }
    if (requiresAdministratorOverride(from) && !options.reason) {
      throw new ValidationError('a reason is required to change a closed ticket', [
        { field: 'reason', code: 'required', message: 'a reason is required' },
      ]);
    }

    assertTransition(from, to);
    if (options.ifMatch !== undefined) requireIfMatch(options.ifMatch, ticket.version);

    // Reopening is bounded by policy, so a ticket cannot come back a year later.
    if (to === 'reopened') {
      const windowDays = await getSetting<number>(ctx, 'ticket.reopen.windowDays');
      const resolvedAt = ticket.resolvedAt?.getTime() ?? 0;
      if (windowDays > 0 && resolvedAt && Date.now() - resolvedAt > windowDays * 86_400_000) {
        throw new ValidationError(`this ticket was resolved more than ${windowDays} days ago; raise a linked ticket instead`);
      }
    }

    const at = new Date();
    const effects = effectsOf(from, to, at);
    const data: Record<string, unknown> = {
      status: to,
      statusCategory: effects.statusCategory,
      updatedBy: ctx.actor.id,
    };
    if (effects.resolvedAt !== 'unchanged') data.resolvedAt = effects.resolvedAt;
    if (effects.closedAt !== 'unchanged') data.closedAt = effects.closedAt;
    if (effects.incrementReopenCount) data.reopenCount = { increment: 1 };

    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, data as never);
    if (affected === 0) throw new ConflictError('this ticket changed while you were working on it', ticket);

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'status.changed', {
      from,
      to,
      reason: options.reason ?? null,
      resolutionCode: options.resolutionCode ?? null,
    });
    await recordAudit(tx, ctx, {
      action: 'ticket.status.changed',
      targetType: 'ticket',
      targetId: ticket.id,
      before: { status: from },
      after: { status: to },
      reason: options.reason ?? null,
    });
    await publish(tx, ctx, {
      definition: events.ticketStatusChanged,
      aggregateId: ticket.id,
      aggregateVersion: ticket.version + 1,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        from,
        to,
        fromCategory: categoryOf(from),
        toCategory: effects.statusCategory,
        reason: options.reason ?? null,
      },
    });

    const updated = (await repo.findById(tx, ticket.id))!;
    await notifyChange(ctx, updated, 'status.changed');
    return updated;
  });
}

export async function assignTicket(
  ctx: TenantContext,
  idOrNumber: string,
  input: { assigneeId?: string | null; groupId?: string | null; method?: 'manual' | 'rule' | 'round_robin' | 'load_balanced' | 'skills' },
  ifMatch?: number,
): Promise<repo.TicketRow> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.assign', { aggregate: 'ticket', record: ticket });
    if (ifMatch !== undefined) requireIfMatch(ifMatch, ticket.version);

    const assigneeId = input.assigneeId === undefined ? ticket.assigneeId : input.assigneeId;
    const groupId = input.groupId === undefined ? ticket.groupId : input.groupId;
    if (assigneeId === ticket.assigneeId && groupId === ticket.groupId) return ticket;

    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, {
      assigneeId,
      groupId,
      updatedBy: ctx.actor.id,
    });
    if (affected === 0) throw new ConflictError('this ticket changed while you were assigning it', ticket);

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'assigned', {
      assigneeId,
      groupId,
      method: input.method ?? 'manual',
    });
    await recordAudit(tx, ctx, {
      action: 'ticket.assigned',
      targetType: 'ticket',
      targetId: ticket.id,
      before: { assigneeId: ticket.assigneeId, groupId: ticket.groupId },
      after: { assigneeId, groupId },
    });
    await publish(tx, ctx, {
      definition: events.ticketAssigned,
      aggregateId: ticket.id,
      aggregateVersion: ticket.version + 1,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        assigneeId,
        groupId,
        method: input.method ?? 'manual',
      },
    });

    const updated = (await repo.findById(tx, ticket.id))!;
    await notifyChange(ctx, updated, 'assigned');
    return updated;
  });
}

export const addCommentSchema = z.object({
  body: z.string().min(1).max(100_000),
  bodyFormat: z.enum(['text', 'html']).default('text'),
  visibility: z.enum(['public', 'internal']).default('public'),
  channel: z.enum(['portal', 'email', 'api', 'slack', 'teams', 'whatsapp', 'voice', 'mobile', 'import', 'system']).default('api'),
  externalRef: z.string().max(500).optional(),
});
export type AddCommentInput = z.input<typeof addCommentSchema>;

export async function addComment(ctx: TenantContext, idOrNumber: string, input: AddCommentInput) {
  const parsed = addCommentSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const permission = parsed.visibility === 'internal' ? 'ticket.comment.internal' : 'ticket.comment.public';
    authz.require(ctx, permission, { aggregate: 'ticket', record: ticket });

    const id = newId();
    const comment = await repo.insertComment(tx, {
      id,
      tenantId: ctx.tenantId,
      ticketId: ticket.id,
      authorId: ctx.actor.id,
      authorType: ctx.actor.type,
      visibility: parsed.visibility,
      body: parsed.body,
      bodyFormat: parsed.bodyFormat,
      channel: parsed.channel,
      externalRef: parsed.externalRef ?? null,
      createdBy: ctx.actor.id,
    });

    await recordAudit(tx, ctx, {
      action: 'ticket.comment.added',
      targetType: 'ticket',
      targetId: ticket.id,
      after: { commentId: id, visibility: parsed.visibility },
    });
    await publish(tx, ctx, {
      definition: events.ticketCommentAdded,
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        commentId: id,
        visibility: parsed.visibility,
        authorId: ctx.actor.id,
        channel: parsed.channel,
      },
    });

    await notifyChange(ctx, ticket, 'comment.added');
    return comment;
  });
}

/**
 * The merged timeline. Internal notes are filtered out for anyone without the
 * internal-note permission, and a contract test asserts they never appear in a
 * requester's projection.
 */
export async function getTimeline(ctx: TenantContext, idOrNumber: string) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const includeInternal = authz.can(ctx, 'ticket.comment.internal', { aggregate: 'ticket', record: ticket });

    const [comments, ticketEvents, tasks, attachments] = await Promise.all([
      repo.listComments(tx, ticket.id, includeInternal),
      repo.listEvents(tx, ticket.id),
      repo.listTasks(tx, ticket.id),
      repo.listAttachments(tx, ticket.id, true),
    ]);

    const entries = [
      ...comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, comment: c })),
      ...ticketEvents.map((e) => ({ kind: 'event' as const, at: e.occurredAt, event: e })),
      ...tasks.map((t) => ({ kind: 'task' as const, at: t.createdAt, task: t })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return { ticket, entries, attachments, includeInternal };
  });
}

export async function createTask(
  ctx: TenantContext,
  idOrNumber: string,
  input: { title: string; description?: string; assigneeId?: string; groupId?: string; dueAt?: Date; key?: string; order?: number },
) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.task.manage', { aggregate: 'ticket', record: ticket });

    const id = newId();
    const task = await tx.ticketTask.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        key: input.key ?? null,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        groupId: input.groupId ?? null,
        dueAt: input.dueAt ?? null,
        order: input.order ?? 0,
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, { action: 'ticket.task.created', targetType: 'ticket_task', targetId: id, after: { title: input.title } });
    await publish(tx, ctx, {
      definition: events.ticketTaskCreated,
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        taskId: id,
        title: input.title,
        assigneeId: input.assigneeId ?? null,
        groupId: input.groupId ?? null,
      },
    });
    return task;
  });
}

export async function completeTask(ctx: TenantContext, taskId: string) {
  return transaction(ctx, async (tx) => {
    const task = await tx.ticketTask.findFirst({ where: { id: taskId } });
    if (!task) throw new NotFoundError('task', taskId);
    const ticket = await loadVisible(tx, ctx, task.ticketId);
    authz.require(ctx, 'ticket.task.manage', { aggregate: 'ticket', record: ticket });
    if (task.status === 'done') return task;

    const blockers = task.blockedBy.length
      ? await tx.ticketTask.findMany({ where: { id: { in: task.blockedBy }, status: { not: 'done' } } })
      : [];
    if (blockers.length > 0) {
      throw new ValidationError(`this task is blocked by ${blockers.length} unfinished task(s)`);
    }

    const updated = await tx.ticketTask.update({
      where: { id: taskId },
      data: { status: 'done', completedAt: new Date(), version: { increment: 1 } },
    });

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'task.completed', { taskId, title: task.title });
    await recordAudit(tx, ctx, { action: 'ticket.task.completed', targetType: 'ticket_task', targetId: taskId, after: { status: 'done' } });
    await publish(tx, ctx, {
      definition: events.ticketTaskCompleted,
      aggregateId: ticket.id,
      payload: { ticketId: ticket.id, number: ticket.number, taskId, key: task.key },
    });
    return updated;
  });
}

export async function linkTickets(ctx: TenantContext, sourceIdOrNumber: string, targetIdOrNumber: string, linkType: LinkType) {
  return transaction(ctx, async (tx) => {
    const source = await loadVisible(tx, ctx, sourceIdOrNumber);
    const target = await loadVisible(tx, ctx, targetIdOrNumber);
    authz.require(ctx, 'ticket.link', { aggregate: 'ticket', record: source });
    if (source.id === target.id) throw new ValidationError('a ticket cannot be linked to itself');

    const existing = await tx.ticketLink.findFirst({ where: { sourceId: source.id, targetId: target.id, linkType } });
    if (existing) return existing;

    const link = await tx.ticketLink.create({
      data: { id: newId(), tenantId: ctx.tenantId, sourceId: source.id, targetId: target.id, linkType, createdBy: ctx.actor.id },
    });
    // The inverse is stored too, so either record can be read without a union query.
    await tx.ticketLink.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        sourceId: target.id,
        targetId: source.id,
        linkType: inverseLinkType[linkType],
        createdBy: ctx.actor.id,
      },
    });

    await repo.insertTicketEvent(tx, ctx, source.id, 'linked', { targetId: target.id, targetNumber: target.number, linkType });
    await recordAudit(tx, ctx, {
      action: 'ticket.linked',
      targetType: 'ticket',
      targetId: source.id,
      after: { targetId: target.id, linkType },
    });
    await publish(tx, ctx, {
      definition: events.ticketLinked,
      aggregateId: source.id,
      payload: { sourceId: source.id, targetId: target.id, linkType },
    });
    return link;
  });
}

export async function addWatcher(ctx: TenantContext, idOrNumber: string, userId: string, reason = 'manual') {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.watch', { aggregate: 'ticket', record: ticket });
    const existing = await tx.ticketWatcher.findFirst({ where: { ticketId: ticket.id, userId } });
    if (existing) return existing;
    return tx.ticketWatcher.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: ticket.id, userId, reason },
    });
  });
}

export async function presignAttachment(
  ctx: TenantContext,
  idOrNumber: string,
  input: { filename: string; mime: string; size: number },
) {
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(`attachments are limited to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`, [
      { field: 'size', code: 'too_large', message: 'file is too large' },
    ]);
  }
  const ticket = await getTicket(ctx, idOrNumber);
  authz.require(ctx, 'ticket.attachment.add', { aggregate: 'ticket', record: ticket });
  return { ticket, upload: presignUpload(ctx, { kind: 'attachment', ...input }) };
}

/**
 * Registers an uploaded object. The attachment stays invisible until the scan
 * worker marks it clean (ADR-0016), so a malicious file is never downloadable
 * even for the moment between upload and scan.
 */
export async function registerAttachment(
  ctx: TenantContext,
  idOrNumber: string,
  input: { objectKey: string; filename: string; mime: string; size: number; commentId?: string },
) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.attachment.add', { aggregate: 'ticket', record: ticket });

    if (!input.objectKey.startsWith(`tenants/${ctx.tenantId}/`)) {
      throw new ValidationError('that object key does not belong to this tenant');
    }

    const id = newId();
    const attachment = await tx.attachment.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        commentId: input.commentId ?? null,
        objectKey: input.objectKey,
        filename: input.filename,
        mime: input.mime,
        size: input.size,
        scanStatus: 'pending',
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'ticket.attachment.added',
      targetType: 'attachment',
      targetId: id,
      after: { filename: input.filename, size: input.size },
    });
    await publish(tx, ctx, {
      definition: events.ticketAttachmentAdded,
      aggregateId: ticket.id,
      payload: { ticketId: ticket.id, number: ticket.number, attachmentId: id, filename: input.filename, size: input.size },
    });
    await enqueue(ctx, 'scan', 'attachment.scan', { attachmentId: id }, { idempotencyKey: `scan-${id}` });

    return attachment;
  });
}

/** Pushes a "something changed" notice to open workspaces (ADR-0015). */
async function notifyChange(ctx: TenantContext, ticket: repo.TicketRow, action: string): Promise<void> {
  const topics = [topicForEntity(ctx.tenantId, 'ticket', ticket.id)];
  if (ticket.requesterId) topics.push(topicForUser(ctx.tenantId, ticket.requesterId));
  if (ticket.assigneeId) topics.push(topicForUser(ctx.tenantId, ticket.assigneeId));
  await publishNotice(ctx, topics, { entity: 'ticket', id: ticket.id, version: ticket.version, action });
}

export { repo, STATES };

// ---------------------------------------------------------------------------
// The automation write path.
//
// MOD-04 stays the only writer of a ticket row (docs/architecture/04 §3), so
// the rules engine — and the workflow engine after it — hands a described change
// to this function rather than reaching for the table. Everything here runs on
// the caller's transaction, which is what lets a rule be exactly-once with the
// event that triggered it.
// ---------------------------------------------------------------------------

/** Fields automation may write. Narrower than a person's update on purpose. */
const AUTOMATION_FIELDS = new Set([
  'impact',
  'urgency',
  'priority',
  'categoryId',
  'subcategoryId',
  'serviceId',
  'orgId',
  'locationId',
  'groupId',
  'dueAt',
]);

export interface AutomationProvenance {
  kind: 'rule' | 'workflow';
  id: string;
  key: string;
  version: number;
  /** Why, in the author's words — carried into the audit entry. */
  reason?: string;
}

export interface AutomatedChange {
  patch?: Record<string, unknown>;
  tags?: string[];
  watchers?: string[];
  status?: { status: string; reason?: string };
}

export interface AutomationOutcome {
  changed: Record<string, { before: unknown; after: unknown }>;
  tagsAdded: string[];
  watchersAdded: string[];
  statusChanged: { from: string; to: string } | null;
  refused: { what: string; why: string }[];
}

/**
 * Applies an automated change to a ticket.
 *
 * Automation is trusted to have been authorised when the rule was published, not
 * when it fires — there is no acting user at that point. What it is *not*
 * trusted to do is produce an impossible ticket, so the state machine still
 * decides whether a status change is legal, and a refused effect is reported
 * rather than thrown: one bad action in a rule must not roll back the event that
 * triggered it.
 */
export async function applyAutomatedChange(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  change: AutomatedChange,
  provenance: AutomationProvenance,
): Promise<AutomationOutcome> {
  const outcome: AutomationOutcome = {
    changed: {},
    tagsAdded: [],
    watchersAdded: [],
    statusChanged: null,
    refused: [],
  };

  const ticket = await repo.findById(tx, ticketId);
  if (!ticket) throw new NotFoundError('ticket not found');

  // --- field writes --------------------------------------------------------
  const data: Record<string, unknown> = {};
  for (const [field, after] of Object.entries(change.patch ?? {})) {
    if (!AUTOMATION_FIELDS.has(field)) {
      outcome.refused.push({ what: `setField ${field}`, why: 'automation may not write this field' });
      continue;
    }
    const before = (ticket as unknown as Record<string, unknown>)[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    outcome.changed[field] = { before, after };
    data[field] = after;
  }

  if (Object.keys(data).length > 0) {
    data.updatedBy = null;
    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, data as never);
    if (affected === 0) {
      // Someone edited the ticket between the event and the rule running. The
      // rule loses: a person's edit is never overwritten by automation.
      outcome.refused.push({ what: 'field changes', why: 'the ticket changed while the rule was running' });
      outcome.changed = {};
    } else {
      await repo.insertTicketEvent(tx, ctx, ticket.id, 'updated', {
        changed: outcome.changed,
        by: { automation: provenance.kind, key: provenance.key, version: provenance.version },
      });
      await recordAudit(tx, ctx, {
        action: 'ticket.updated',
        targetType: 'ticket',
        targetId: ticket.id,
        before: Object.fromEntries(Object.entries(outcome.changed).map(([k, v]) => [k, v.before])),
        after: Object.fromEntries(Object.entries(outcome.changed).map(([k, v]) => [k, v.after])),
        reason: provenance.reason ?? `${provenance.kind} ${provenance.key} v${provenance.version}`,
      });
      await publish(tx, ctx, {
        definition: events.ticketUpdated,
        aggregateId: ticket.id,
        aggregateVersion: ticket.version + 1,
        payload: { ticketId: ticket.id, number: ticket.number, changed: outcome.changed },
        actorOverride: automationActor(provenance),
      });
    }
  }

  // --- tags ----------------------------------------------------------------
  for (const tag of change.tags ?? []) {
    const existing = await tx.ticketTag.findFirst({ where: { ticketId: ticket.id, tag } });
    if (existing) continue;
    await tx.ticketTag.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        tag,
        addedBy: null,
        addedByType: provenance.kind,
      },
    });
    outcome.tagsAdded.push(tag);
  }

  // --- watchers ------------------------------------------------------------
  for (const userId of change.watchers ?? []) {
    const existing = await tx.ticketWatcher.findFirst({ where: { ticketId: ticket.id, userId } });
    if (existing) continue;
    await tx.ticketWatcher.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: ticket.id, userId, reason: provenance.kind },
    });
    outcome.watchersAdded.push(userId);
  }

  // --- status --------------------------------------------------------------
  if (change.status) {
    const from = ticket.status as CanonicalState;
    const to = change.status.status as CanonicalState;
    if (!canTransition(from, to)) {
      outcome.refused.push({ what: `setStatus ${to}`, why: `a ticket cannot move from ${from} to ${to}` });
    } else if (from !== to) {
      const at = new Date();
      const stateEffects = effectsOf(from, to, at);
      const statusData: Record<string, unknown> = {
        status: to,
        statusCategory: stateEffects.statusCategory,
        updatedBy: null,
      };
      if (stateEffects.resolvedAt !== 'unchanged') statusData.resolvedAt = stateEffects.resolvedAt;
      if (stateEffects.closedAt !== 'unchanged') statusData.closedAt = stateEffects.closedAt;
      if (stateEffects.incrementReopenCount) statusData.reopenCount = { increment: 1 };

      const current = (await repo.findById(tx, ticket.id))!;
      const affected = await repo.updateWithVersion(tx, current.id, current.version, statusData as never);
      if (affected === 0) {
        outcome.refused.push({ what: `setStatus ${to}`, why: 'the ticket changed while the rule was running' });
      } else {
        outcome.statusChanged = { from, to };
        await repo.insertTicketEvent(tx, ctx, ticket.id, 'status.changed', {
          from,
          to,
          reason: change.status.reason ?? null,
          by: { automation: provenance.kind, key: provenance.key, version: provenance.version },
        });
        await recordAudit(tx, ctx, {
          action: 'ticket.status.changed',
          targetType: 'ticket',
          targetId: ticket.id,
          before: { status: from },
          after: { status: to },
          reason: change.status.reason ?? `${provenance.kind} ${provenance.key} v${provenance.version}`,
        });
        await publish(tx, ctx, {
          definition: events.ticketStatusChanged,
          aggregateId: ticket.id,
          aggregateVersion: current.version + 1,
          payload: {
            ticketId: ticket.id,
            number: ticket.number,
            from,
            to,
            fromCategory: categoryOf(from),
            toCategory: stateEffects.statusCategory,
            reason: change.status.reason ?? null,
          },
          actorOverride: automationActor(provenance),
        });
      }
    }
  }

  return outcome;
}

/**
 * Automation acts as itself, not as whoever happened to trigger the event.
 *
 * This is what stops a rule reacting to its own write: a consumer that sees a
 * `workflow` actor knows the change came from automation, and the rules engine
 * uses exactly that to avoid looping.
 */
function automationActor(provenance: AutomationProvenance) {
  return { type: 'workflow' as const, id: provenance.id, displayName: `${provenance.kind}:${provenance.key}` };
}

/**
 * The tags on a ticket.
 *
 * Goes through `loadVisible` rather than straight to the table: a tag can say
 * "vip" or "security-incident", so listing one must refuse for the same people,
 * and in the same way, as reading the ticket itself.
 */
export async function listTags(ctx: TenantContext, idOrNumber: string): Promise<string[]> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket });
    const rows = await tx.ticketTag.findMany({ where: { ticketId: ticket.id }, orderBy: { tag: 'asc' } });
    return rows.map((row) => row.tag);
  });
}
