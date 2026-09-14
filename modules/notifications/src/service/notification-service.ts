import type { EventEnvelope } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  authz,
  enqueue,
  getSetting,
  logger,
  metrics,
  newId,
  NotFoundError,
  publish,
  publishNotice,
  topicForUser,
  transaction,
} from '@itsm/platform';
import { evaluate, events, type Expr } from '@itsm/contracts';
import { renderTemplate } from './template.js';

/**
 * MOD-11 notification engine.
 *
 * Rules map an event to an audience and a template. Exactly one notification
 * row exists per (event, recipient, rule), and that uniqueness is what makes
 * dispatch idempotent: the same event delivered twice cannot notify the same
 * person twice (MOD-11-E1-S1).
 */

export type AudienceDescriptor =
  | { kind: 'requester' }
  | { kind: 'assignee' }
  | { kind: 'group' }
  | { kind: 'watchers' }
  | { kind: 'role'; key: string }
  | { kind: 'user'; userId: string };

interface TicketLike {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  requesterId: string | null;
  assigneeId: string | null;
  groupId: string | null;
}

/** Resolves an audience to concrete recipients, inside the tenant transaction. */
export async function resolveAudience(
  tx: Tx,
  ctx: TenantContext,
  audience: AudienceDescriptor[],
  ticket: TicketLike | null,
): Promise<string[]> {
  const recipients = new Set<string>();

  for (const entry of audience) {
    switch (entry.kind) {
      case 'requester':
        if (ticket?.requesterId) recipients.add(ticket.requesterId);
        break;
      case 'assignee':
        if (ticket?.assigneeId) recipients.add(ticket.assigneeId);
        break;
      case 'group': {
        if (!ticket?.groupId) break;
        const members = await tx.teamMembership.findMany({ where: { teamId: ticket.groupId } });
        members.forEach((member) => recipients.add(member.userId));
        break;
      }
      case 'watchers': {
        if (!ticket) break;
        const watchers = await tx.ticketWatcher.findMany({ where: { ticketId: ticket.id } });
        watchers.forEach((watcher) => recipients.add(watcher.userId));
        break;
      }
      case 'role': {
        const role = await tx.role.findFirst({ where: { key: entry.key } });
        if (!role) break;
        const assignments = await tx.roleAssignment.findMany({ where: { roleId: role.id } });
        assignments.forEach((assignment) => recipients.add(assignment.userId));
        break;
      }
      case 'user':
        recipients.add(entry.userId);
        break;
    }
  }

  return [...recipients];
}

/**
 * Evaluates every active rule for an event and queues what it produces. Runs
 * inside the consumer's transaction, so a failure rolls back the inbox claim
 * and the whole thing is retried rather than half-notifying.
 */
export async function notifyForEvent(ctx: TenantContext, envelope: EventEnvelope, tx: Tx): Promise<number> {
  const rules = await tx.notificationRule.findMany({ where: { eventType: envelope.type, isActive: true } });
  if (rules.length === 0) return 0;

  const payload = envelope.payload as Record<string, unknown>;
  const ticketId = typeof payload.ticketId === 'string' ? payload.ticketId : null;
  const ticket = ticketId ? ((await tx.ticket.findFirst({ where: { id: ticketId } })) as TicketLike | null) : null;

  const emailEnabled = await getSetting<boolean>(ctx, 'notification.email.enabled');
  let queued = 0;

  for (const rule of rules) {
    if (rule.conditions) {
      const conditionContext = { event: envelope, payload, ticket, now: envelope.occurredAt };
      try {
        if (!evaluate(rule.conditions as Expr, conditionContext)) continue;
      } catch (error) {
        // A broken condition must not stop other rules from notifying.
        logger.warn('notification rule condition failed to evaluate; skipping', {
          ruleKey: rule.key,
          error: (error as Error).message,
        });
        continue;
      }
    }

    const recipients = await resolveAudience(tx, ctx, rule.audience as AudienceDescriptor[], ticket);

    for (const recipientId of recipients) {
      // Nobody is told about their own action.
      if (recipientId === envelope.actor.id) continue;

      const recipient = await tx.user.findFirst({ where: { id: recipientId, status: 'active', deletedAt: null } });
      if (!recipient) continue;

      const template = await tx.notificationTemplate.findFirst({
        where: { key: rule.templateKey, channel: 'inapp', locale: { in: [recipient.locale, 'en-GB'] } },
        orderBy: { locale: 'desc' },
      });
      if (!template) {
        logger.warn('no template for notification rule', { ruleKey: rule.key, templateKey: rule.templateKey });
        continue;
      }

      const renderContext = {
        ticket: ticket ?? {},
        event: { type: envelope.type },
        recipient: { displayName: recipient.displayName },
        payload,
      };
      const subject = template.subject ? renderTemplate(template.subject, renderContext) : null;
      const body = renderTemplate(template.body, renderContext);

      const notificationId = newId();
      const created = await tx.notification.createMany({
        data: [
          {
            id: notificationId,
            tenantId: ctx.tenantId,
            eventId: envelope.id,
            eventType: envelope.type,
            recipientId,
            ruleKey: rule.key,
            templateKey: rule.templateKey,
            ticketId: ticket?.id ?? null,
            subject,
            body,
            status: 'queued',
          },
        ],
        skipDuplicates: true,
      });
      // skipDuplicates turns a replay into a no-op rather than a second message.
      if (created.count === 0) continue;

      await publish(tx, ctx, {
        definition: events.notificationQueued,
        aggregateId: notificationId,
        payload: { notificationId, recipientId, channel: 'inapp', templateKey: rule.templateKey },
      });

      const channels = (rule.channels as string[]).filter((channel) => channel !== 'email' || emailEnabled);
      for (const channel of channels) {
        await enqueue(
          ctx,
          'notify',
          'notification.dispatch',
          { notificationId, channel },
          { idempotencyKey: `notify:${notificationId}:${channel}` },
        );
      }
      queued += 1;
    }
  }

  metrics.increment('notifications_queued_total', { event: envelope.type }, queued);
  return queued;
}

export interface DeliveryTransport {
  channel: string;
  send(input: { to: string; subject: string | null; body: string }): Promise<{ providerRef: string | null }>;
}

const transports = new Map<string, DeliveryTransport>();

export function registerTransport(transport: DeliveryTransport): void {
  transports.set(transport.channel, transport);
}

export function registeredTransports(): string[] {
  return [...transports.keys()];
}

/** Delivers one notification on one channel, recording every attempt. */
export async function dispatch(
  ctx: TenantContext,
  notificationId: string,
  channel: string,
): Promise<'sent' | 'skipped'> {
  return transaction(ctx, async (tx) => {
    const notification = await tx.notification.findFirst({ where: { id: notificationId } });
    if (!notification) throw new NotFoundError('notification', notificationId);

    // In-app delivery is the row itself: it is already readable in the inbox.
    if (channel === 'inapp') {
      await tx.notification.update({ where: { id: notificationId }, data: { status: 'sent' } });
      await publishNotice(ctx, [topicForUser(ctx.tenantId, notification.recipientId)], {
        entity: 'notification',
        id: notificationId,
        action: 'queued',
      });
      return 'sent';
    }

    const transport = transports.get(channel);
    if (!transport) {
      logger.warn('no transport registered for channel', { channel });
      return 'skipped';
    }

    const recipient = await tx.user.findFirst({ where: { id: notification.recipientId } });
    if (!recipient) return 'skipped';

    const preference = await tx.notificationPreference.findFirst({
      where: { userId: notification.recipientId, channel },
    });
    if (preference && !preference.enabled) return 'skipped';

    const attemptNumber = (await tx.deliveryAttempt.count({ where: { notificationId, channel } })) + 1;

    try {
      const result = await transport.send({ to: recipient.email, subject: notification.subject, body: notification.body });
      await tx.deliveryAttempt.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          notificationId,
          channel,
          attempt: attemptNumber,
          status: 'sent',
          providerRef: result.providerRef,
        },
      });
      await tx.notification.update({ where: { id: notificationId }, data: { status: 'sent' } });
      await publish(tx, ctx, {
        definition: events.notificationSent,
        aggregateId: notificationId,
        payload: { notificationId, channel, providerRef: result.providerRef },
      });
      metrics.increment('notifications_sent_total', { channel });
      return 'sent';
    } catch (error) {
      const message = (error as Error).message;
      await tx.deliveryAttempt.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          notificationId,
          channel,
          attempt: attemptNumber,
          status: 'failed',
          error: message,
        },
      });
      await publish(tx, ctx, {
        definition: events.notificationFailed,
        aggregateId: notificationId,
        payload: { notificationId, channel, error: message },
      });
      metrics.increment('notifications_failed_total', { channel });
      // Rethrowing hands the retry decision to the queue's backoff policy.
      throw error;
    }
  });
}

export async function listInbox(ctx: TenantContext, options: { limit: number; unreadOnly?: boolean }) {
  authz.require(ctx, 'notification.read');
  const userId = ctx.actor.id;
  if (!userId) return { data: [], unread: 0 };

  return transaction(ctx, async (tx) => {
    const where = { recipientId: userId, ...(options.unreadOnly ? { readAt: null } : {}) };
    const [data, unread] = await Promise.all([
      tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: options.limit }),
      tx.notification.count({ where: { recipientId: userId, readAt: null } }),
    ]);
    return { data, unread };
  });
}

export async function markRead(ctx: TenantContext, notificationId: string | 'all'): Promise<number> {
  authz.require(ctx, 'notification.read');
  const userId = ctx.actor.id;
  if (!userId) return 0;

  return transaction(ctx, async (tx) => {
    const result = await tx.notification.updateMany({
      where: {
        recipientId: userId,
        readAt: null,
        ...(notificationId === 'all' ? {} : { id: notificationId }),
      },
      data: { readAt: new Date() },
    });
    return result.count;
  });
}
