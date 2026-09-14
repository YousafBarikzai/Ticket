import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PreconditionRequiredError, ValidationError } from '@itsm/platform';
import { ticketService, type TicketRow } from '@itsm/module-ticket';
import { timerService } from '@itsm/module-sla';
import { canonicalStateSchema, linkTypeSchema } from '@itsm/contracts';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-04 routes.
 *
 * Routes parse, call the service and shape the response. They never authorise
 * and never touch the database: that is the module contract, and it is what
 * keeps the same rules in force whether a change arrives from the API, a job,
 * a channel adapter or the worker.
 */

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
  sort: z.enum(['createdAt', '-createdAt', 'dueAt', '-dueAt']).default('-createdAt'),
  'filter[status]': z.string().optional(),
  'filter[statusCategory]': z.string().optional(),
  'filter[type]': z.string().optional(),
  'filter[priority]': z.string().optional(),
  'filter[assignee]': z.string().optional(),
  'filter[group]': z.string().uuid().optional(),
  'filter[requester]': z.string().optional(),
  'filter[service]': z.string().uuid().optional(),
  q: z.string().max(200).optional(),
});

/** Turns the public filter grammar into the repository's filter shape. */
function toFilter(query: z.infer<typeof listQuerySchema>, actorId: string | null) {
  const csv = (value?: string): string[] | undefined => (value ? value.split(',').filter(Boolean) : undefined);
  const assignee = query['filter[assignee]'];
  const requester = query['filter[requester]'];

  return {
    ...(csv(query['filter[status]']) ? { status: csv(query['filter[status]']) } : {}),
    ...(csv(query['filter[statusCategory]']) ? { statusCategory: csv(query['filter[statusCategory]']) } : {}),
    ...(csv(query['filter[type]']) ? { type: csv(query['filter[type]']) } : {}),
    ...(csv(query['filter[priority]']) ? { priority: csv(query['filter[priority]']) } : {}),
    // `me` is resolved server-side so a saved view is portable between people.
    ...(assignee ? { assigneeId: assignee === 'me' ? actorId : assignee === 'none' ? null : assignee } : {}),
    ...(query['filter[group]'] ? { groupId: query['filter[group]'] } : {}),
    ...(requester ? { requesterId: requester === 'me' ? (actorId ?? undefined) : requester } : {}),
    ...(query['filter[service]'] ? { serviceId: query['filter[service]'] } : {}),
    ...(query.q ? { search: query.q } : {}),
  };
}

function present(ticket: TicketRow) {
  return {
    id: ticket.id,
    number: ticket.number,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    statusCategory: ticket.statusCategory,
    priority: ticket.priority,
    impact: ticket.impact,
    urgency: ticket.urgency,
    requesterId: ticket.requesterId,
    affectedUserId: ticket.affectedUserId,
    assigneeId: ticket.assigneeId,
    groupId: ticket.groupId,
    serviceId: ticket.serviceId,
    categoryId: ticket.categoryId,
    orgId: ticket.orgId,
    sourceChannel: ticket.sourceChannel,
    parentId: ticket.parentId,
    dueAt: ticket.dueAt?.toISOString() ?? null,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    reopenCount: ticket.reopenCount,
    custom: ticket.custom,
    version: ticket.version,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

/** `If-Match` carries the version the client last saw (specification §7). */
function ifMatch(header: string | undefined, required: boolean): number | undefined {
  if (!header) {
    if (required) throw new PreconditionRequiredError();
    return undefined;
  }
  const value = Number(header.replace(/"/g, ''));
  if (!Number.isInteger(value)) throw new ValidationError('If-Match must be the entity version');
  return value;
}

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tickets', async (request, reply) => {
    const ctx = contextOf(request);
    const ticket = await ticketService.createTicket(ctx, ticketService.createTicketSchema.parse(request.body));
    reply.status(201).header('etag', `"${ticket.version}"`).header('location', `/api/v1/tickets/${ticket.number}`);
    return present(ticket);
  });

  app.get('/tickets', async (request) => {
    const ctx = contextOf(request);
    const query = listQuerySchema.parse(request.query);
    const result = await ticketService.listTickets(ctx, toFilter(query, ctx.actor.id), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      sort: query.sort,
    });
    return { data: result.data.map(present), nextCursor: result.nextCursor };
  });

  app.get('/tickets/:idOrNumber', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const ticket = await ticketService.getTicket(ctx, idOrNumber);
    reply.header('etag', `"${ticket.version}"`);
    return present(ticket);
  });

  app.patch('/tickets/:idOrNumber', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const ticket = await ticketService.updateTicket(
      ctx,
      idOrNumber,
      ticketService.updateTicketSchema.parse(request.body),
      ifMatch(request.headers['if-match'] as string | undefined, true),
    );
    reply.header('etag', `"${ticket.version}"`);
    return present(ticket);
  });

  app.post('/tickets/:idOrNumber/transitions', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z
      .object({
        to: canonicalStateSchema,
        reason: z.string().max(2000).optional(),
        resolutionCode: z.string().max(100).optional(),
      })
      .parse(request.body);

    const ticket = await ticketService.transitionTicket(ctx, idOrNumber, body.to, {
      ...(body.reason ? { reason: body.reason } : {}),
      ...(body.resolutionCode ? { resolutionCode: body.resolutionCode } : {}),
      ...(request.headers['if-match'] ? { ifMatch: ifMatch(request.headers['if-match'] as string, false)! } : {}),
    });
    reply.header('etag', `"${ticket.version}"`);
    return present(ticket);
  });

  app.post('/tickets/:idOrNumber/assign', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z
      .object({
        assigneeId: z.string().uuid().nullable().optional(),
        groupId: z.string().uuid().nullable().optional(),
        method: z.enum(['manual', 'rule', 'round_robin', 'load_balanced', 'skills']).optional(),
      })
      .parse(request.body);

    const ticket = await ticketService.assignTicket(ctx, idOrNumber, body);
    reply.header('etag', `"${ticket.version}"`);
    return present(ticket);
  });

  app.post('/tickets/:idOrNumber/comments', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const comment = await ticketService.addComment(ctx, idOrNumber, ticketService.addCommentSchema.parse(request.body));
    reply.status(201);
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      authorId: comment.authorId,
      visibility: comment.visibility,
      body: comment.body,
      bodyFormat: comment.bodyFormat,
      channel: comment.channel,
      createdAt: comment.createdAt.toISOString(),
    };
  });

  app.get('/tickets/:idOrNumber/timeline', async (request) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const timeline = await ticketService.getTimeline(ctx, idOrNumber);

    return {
      ticket: present(timeline.ticket),
      // Internal notes are filtered in the service; the flag tells the client
      // whether it is seeing the agent view or the requester view.
      includesInternal: timeline.includeInternal,
      entries: timeline.entries.map((entry) => {
        if (entry.kind === 'comment') {
          return {
            kind: 'comment' as const,
            at: entry.at.toISOString(),
            id: entry.comment.id,
            visibility: entry.comment.visibility,
            authorId: entry.comment.authorId,
            body: entry.comment.body,
            channel: entry.comment.channel,
          };
        }
        if (entry.kind === 'event') {
          return {
            kind: 'event' as const,
            at: entry.at.toISOString(),
            id: entry.event.id,
            type: entry.event.type,
            actorType: entry.event.actorType,
            actorId: entry.event.actorId,
            payload: entry.event.payload,
          };
        }
        return {
          kind: 'task' as const,
          at: entry.at.toISOString(),
          id: entry.task.id,
          title: entry.task.title,
          status: entry.task.status,
          assigneeId: entry.task.assigneeId,
        };
      }),
      attachments: timeline.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mime: attachment.mime,
        size: attachment.size,
        createdAt: attachment.createdAt.toISOString(),
      })),
    };
  });

  app.get('/tickets/:idOrNumber/sla', async (request) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const ticket = await ticketService.getTicket(ctx, idOrNumber);
    const timers = await timerService.listTimersForTicket(ctx, ticket.id);

    return {
      ticketId: ticket.id,
      timers: timers.map((timer) => ({
        id: timer.id,
        targetType: timer.targetType,
        state: timer.state,
        startedAt: timer.startedAt.toISOString(),
        dueAt: timer.dueAt?.toISOString() ?? null,
        remainingMs: timer.remainingMs,
        elapsedMs: timer.elapsedMs,
        warningsFired: timer.warningsFired,
        metAt: timer.metAt?.toISOString() ?? null,
        breachedAt: timer.breachedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/tickets/:idOrNumber/tasks', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z
      .object({
        title: z.string().min(1).max(500),
        description: z.string().max(10_000).optional(),
        assigneeId: z.string().uuid().optional(),
        groupId: z.string().uuid().optional(),
        key: z.string().max(100).optional(),
        order: z.number().int().min(0).max(1000).optional(),
      })
      .parse(request.body);

    const task = await ticketService.createTask(ctx, idOrNumber, body);
    reply.status(201);
    return { id: task.id, title: task.title, status: task.status, order: task.order };
  });

  app.post('/tasks/:taskId/complete', async (request) => {
    const ctx = contextOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const task = await ticketService.completeTask(ctx, taskId);
    return { id: task.id, status: task.status, completedAt: task.completedAt?.toISOString() ?? null };
  });

  app.post('/tickets/:idOrNumber/links', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z.object({ target: z.string().min(1).max(100), linkType: linkTypeSchema }).parse(request.body);
    const link = await ticketService.linkTickets(ctx, idOrNumber, body.target, body.linkType);
    reply.status(201);
    return { sourceId: link.sourceId, targetId: link.targetId, linkType: link.linkType };
  });

  app.post('/tickets/:idOrNumber/watchers', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z.object({ userId: z.string().uuid() }).parse(request.body);
    const watcher = await ticketService.addWatcher(ctx, idOrNumber, body.userId);
    reply.status(201);
    return { ticketId: watcher.ticketId, userId: watcher.userId, reason: watcher.reason };
  });

  app.post('/tickets/:idOrNumber/attachments:presign', async (request) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z
      .object({
        filename: z.string().min(1).max(255),
        mime: z.string().min(1).max(200),
        size: z.number().int().min(1),
      })
      .parse(request.body);

    const { upload } = await ticketService.presignAttachment(ctx, idOrNumber, body);
    return upload;
  });

  app.post('/tickets/:idOrNumber/attachments', async (request, reply) => {
    const ctx = contextOf(request);
    const { idOrNumber } = z.object({ idOrNumber: z.string().min(1).max(100) }).parse(request.params);
    const body = z
      .object({
        objectKey: z.string().min(1).max(500),
        filename: z.string().min(1).max(255),
        mime: z.string().min(1).max(200),
        size: z.number().int().min(1),
        commentId: z.string().uuid().optional(),
      })
      .parse(request.body);

    const attachment = await ticketService.registerAttachment(ctx, idOrNumber, body);
    reply.status(201);
    return {
      id: attachment.id,
      filename: attachment.filename,
      size: attachment.size,
      // Deliberately visible: a client should show "scanning" rather than a
      // broken download link (ADR-0016).
      scanStatus: attachment.scanStatus,
    };
  });
}
