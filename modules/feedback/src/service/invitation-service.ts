import { events, evaluate, type Expr } from '@itsm/contracts';
import {
  ForbiddenError,
  NotFoundError,
  authz,
  enqueue,
  digest,
  loadConfig,
  logger,
  metrics,
  newId,
  publish,
  signToken,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { postToTicketThread } from '@itsm/module-channels';
import { expiryFor, withinThrottle } from '../domain/throttle.js';
import { currentVersion, type TriggerKind } from './survey-service.js';

/**
 * Asking.
 *
 * A trigger fires, a survey is chosen, a person is chosen, and — unless they
 * were asked too recently, or already asked about this thing — an invitation
 * is created and sent two ways: `survey.invited` for MOD-11 to email, and a
 * job to post it into the chat thread the ticket lives in, if it lives in one.
 * The chat post is a job rather than a call because it is an outbound HTTP
 * request and this runs inside an event consumer's transaction.
 */

export interface TriggerSubject {
  ticketId: string;
  incidentId?: string | null;
  /** The person who caused the event; they are never asked to rate themselves. */
  actorId: string | null;
  incident?: { severity: string } | null;
}

interface TicketFacts {
  id: string;
  number: string;
  type: string;
  priority: string;
  serviceId: string | null;
  categoryId: string | null;
  groupId: string | null;
  sourceChannel: string;
  requesterId: string | null;
  reopenCount: number;
}

function surveyUrl(token: string): string {
  return `${loadConfig().API_BASE_URL}/api/v1/public/surveys/${token}`;
}

/**
 * Runs every active trigger of a kind against a subject and invites at most
 * once. The first trigger whose conditions hold wins, in creation order, so a
 * specific survey ("for the payments service") is added after the general one
 * and listed before it — the same rule as everywhere else specificity matters.
 */
export async function inviteForTrigger(
  ctx: TenantContext,
  tx: Tx,
  kind: TriggerKind,
  subject: TriggerSubject,
  now: Date = new Date(),
): Promise<{ invited: boolean; reason?: string; invitationId?: string }> {
  const ticket = (await tx.ticket.findFirst({
    where: { id: subject.ticketId },
    select: { id: true, number: true, type: true, priority: true, serviceId: true, categoryId: true, groupId: true, sourceChannel: true, requesterId: true, reopenCount: true },
  })) as TicketFacts | null;
  if (!ticket) return { invited: false, reason: 'no_ticket' };
  if (!ticket.requesterId) return { invited: false, reason: 'no_requester' };
  if (ticket.requesterId === subject.actorId) return { invited: false, reason: 'self_resolved' };

  const requester = await tx.user.findFirst({ where: { id: ticket.requesterId, status: 'active', deletedAt: null }, select: { id: true } });
  if (!requester) return { invited: false, reason: 'requester_inactive' };

  const triggers = await tx.surveyTrigger.findMany({ where: { kind, isActive: true }, orderBy: { createdAt: 'asc' } });
  const conditionContext = {
    ticket: {
      type: ticket.type,
      priority: ticket.priority,
      serviceId: ticket.serviceId,
      categoryId: ticket.categoryId,
      groupId: ticket.groupId,
      channel: ticket.sourceChannel,
      reopenCount: ticket.reopenCount,
    },
    incident: subject.incident ?? {},
  };

  for (const trigger of triggers) {
    if (trigger.conditions) {
      try {
        if (!evaluate(trigger.conditions as Expr, conditionContext)) continue;
      } catch (error) {
        // A broken condition must not stop the next trigger from asking.
        logger.warn('a survey trigger condition failed to evaluate; skipping', { triggerId: trigger.id, error: (error as Error).message });
        continue;
      }
    }

    const live = await currentVersion(tx, trigger.surveyId);
    if (!live) continue;

    // Once per person per thing, whatever route it arrives by.
    const already = await tx.surveyInvitation.findFirst({
      where: { surveyId: trigger.surveyId, ticketId: ticket.id, recipientId: ticket.requesterId },
    });
    if (already) {
      metrics.increment('survey_invitations_skipped_total', { reason: 'already_asked' });
      return { invited: false, reason: 'already_asked' };
    }

    const last = await tx.surveyInvitation.findFirst({
      where: { recipientId: ticket.requesterId },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    });
    if (withinThrottle({ lastInvitedAt: last?.sentAt ?? null, throttleDays: trigger.throttleDays, now })) {
      metrics.increment('survey_invitations_skipped_total', { reason: 'throttled' });
      return { invited: false, reason: 'throttled' };
    }

    const invitationId = newId();
    const expiresAt = expiryFor(now, trigger.expiryDays);
    const token = signToken({ tenantId: ctx.tenantId, kind: 'survey_invitation', subjectId: invitationId, expiresAt: expiresAt.toISOString() });

    await tx.surveyInvitation.create({
      data: {
        id: invitationId,
        tenantId: ctx.tenantId,
        surveyId: trigger.surveyId,
        versionId: live.version.id,
        triggerId: trigger.id,
        ticketId: ticket.id,
        incidentId: subject.incidentId ?? null,
        recipientId: ticket.requesterId,
        // The hash, never the token: the link in the inbox is the only copy.
        tokenHash: digest(token),
        expiresAt,
        sentAt: now,
        channels: ['email'],
      },
    });

    await publish(tx, ctx, {
      definition: events.surveyInvited,
      aggregateId: invitationId,
      payload: {
        invitationId,
        surveyId: trigger.surveyId,
        surveyKey: live.survey.key,
        surveyName: live.survey.name,
        version: live.version.version,
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        recipientId: ticket.requesterId,
        surveyUrl: surveyUrl(token),
        expiresAt: expiresAt.toISOString().slice(0, 10),
        audience: [{ kind: 'user', userId: ticket.requesterId }],
      },
    });

    // Where the person already is, if anywhere.
    await enqueue(ctx, 'channels', 'survey.chat.post', { invitationId }, { idempotencyKey: `survey-chat-${invitationId}` });

    metrics.increment('survey_invitations_total', { kind });
    return { invited: true, invitationId };
  }

  return { invited: false, reason: 'no_trigger_matched' };
}

/** The buttons for a scale, or none when the scale is too wide to be buttons. */
export function ratingActions(scoring: { min: number; max: number } | undefined, invitationId: string) {
  if (!scoring || scoring.max - scoring.min + 1 > 5) return [];
  const actions: { label: string; value: Record<string, unknown> }[] = [];
  for (let value = scoring.min; value <= scoring.max; value += 1) {
    actions.push({ label: String(value), value: { action: 'custom', name: 'survey', data: { invitationId, value } } });
  }
  return actions;
}

/**
 * Posts the ask into the ticket's chat thread. Run as a job, so the HTTP call
 * happens outside the event consumer's transaction.
 */
export async function postToChat(ctx: TenantContext, invitationId: string): Promise<{ posted: boolean }> {
  return transaction(ctx, async (tx) => {
    const invitation = await tx.surveyInvitation.findFirst({ where: { id: invitationId } });
    if (!invitation || invitation.status !== 'pending' || !invitation.ticketId) return { posted: false };

    const live = await tx.surveyVersion.findFirst({ where: { id: invitation.versionId } });
    const document = live?.document as { title?: string; scoring?: { min: number; max: number; field: string } } | undefined;
    if (!document) return { posted: false };

    const scale = document.scoring ? ` Reply with a number from ${document.scoring.min} to ${document.scoring.max}.` : '';
    const outcome = await postToTicketThread(
      ctx,
      tx,
      invitation.ticketId,
      {
        text: `${document.title ?? 'How did we do?'} Your ticket has been resolved — how satisfied are you with how it was handled?${scale}`,
        actions: ratingActions(document.scoring, invitationId),
      },
      { action: 'survey', data: { invitationId }, expiresAt: invitation.expiresAt.toISOString() },
    );

    if (outcome.posted && outcome.channel) {
      await tx.surveyInvitation.update({
        where: { id: invitationId },
        data: { conversationId: outcome.conversationId, channels: { push: outcome.channel } },
      });
    }
    return { posted: outcome.posted };
  });
}

/** Invitations past their date, marked so the link says so. */
export async function expireDue(ctx: TenantContext, now: Date = new Date()): Promise<number> {
  return transaction(ctx, async (tx) => {
    const result = await tx.surveyInvitation.updateMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
    if (result.count > 0) metrics.increment('survey_invitations_expired_total', {}, result.count);
    return result.count;
  });
}

export async function listInvitations(ctx: TenantContext, filter: { ticketId?: string; status?: string }, limit = 50) {
  authz.require(ctx, 'feedback.read');
  return transaction(ctx, async (tx) => {
    const rows = await tx.surveyInvitation.findMany({
      where: { ...(filter.ticketId ? { ticketId: filter.ticketId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
    return narrowToScope(ctx, tx, rows);
  });
}

/** A team-scoped reader sees invitations about their teams' tickets and nothing else. */
export async function narrowToScope<T extends { ticketId: string | null }>(ctx: TenantContext, tx: Tx, rows: T[]): Promise<T[]> {
  const scope = authz.effectiveScope(ctx, 'feedback.read');
  if (scope === 'any') return rows;
  if (scope !== 'team') throw new ForbiddenError('feedback.read is required');
  const ticketIds = rows.map((row) => row.ticketId).filter((id): id is string => id !== null);
  if (ticketIds.length === 0) return [];
  const visible = new Set(
    (await tx.ticket.findMany({ where: { id: { in: ticketIds }, groupId: { in: ctx.teamIds } }, select: { id: true } })).map((t) => t.id),
  );
  return rows.filter((row) => row.ticketId !== null && visible.has(row.ticketId));
}

export async function getInvitation(ctx: TenantContext, id: string) {
  authz.require(ctx, 'feedback.read');
  return transaction(ctx, async (tx) => {
    const row = await tx.surveyInvitation.findFirst({ where: { id } });
    if (!row) throw new NotFoundError('survey invitation', id);
    const [visible] = await narrowToScope(ctx, tx, [row]);
    if (!visible) throw new NotFoundError('survey invitation', id);
    return visible;
  });
}
