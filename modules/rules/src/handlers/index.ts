import { defineHandler, logger, type TenantContext, type Tx } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { notificationService } from '@itsm/module-notifications';
import { decide, effectsOf, recordApplications } from '../service/engine.js';
import { loadPublishedRules } from '../service/rule-service.js';
import { factsForTicket } from '../service/facts.js';
import type { RuleEvent } from '../domain/actions.js';

/**
 * MOD-06-E0 reacts to the events a rule may be written against.
 *
 * Every handler does the same four things — load the published rules, decide,
 * apply through the owning module's service, record what happened — so the
 * per-event handlers stay thin and the behaviour lives in one place.
 */

async function runRules(
  ctx: TenantContext,
  tx: Tx,
  event: RuleEvent,
  ticketId: string,
  eventId: string,
  extra: { comment?: { visibility: string; authorId: string | null } } = {},
): Promise<void> {
  const rules = await loadPublishedRules(tx, event);
  if (rules.length === 0) return;

  const ticket = await tx.ticket.findFirst({ where: { id: ticketId } });
  if (!ticket) return;

  const requester = ticket.requesterId
    ? await tx.user.findFirst({ where: { id: ticket.requesterId } })
    : null;

  const decision = decide(
    rules,
    factsForTicket(ticket as never, {
      event,
      ...(extra.comment ? { comment: extra.comment } : {}),
      requester: requester
        ? { orgId: requester.primaryOrgId ?? null, locationId: null, vip: requester.vip, tier: requester.tier }
        : null,
    }),
  );
  if (decision.matched.length === 0) {
    // Errors can occur with no match, and are still the author's to fix.
    await recordApplications(ctx, tx, decision, event, ticketId);
    return;
  }

  const effects = effectsOf(decision);
  const outcome = await ticketService.applyAutomatedChange(
    ctx,
    tx,
    ticketId,
    {
      patch: effects.patch,
      tags: effects.tags,
      watchers: effects.watchers,
      ...(effects.status ? { status: effects.status } : {}),
    },
    {
      kind: 'rule',
      id: decision.matched[0]!.ruleId,
      key: decision.matched.map((m) => m.ruleKey).join(', '),
      version: decision.matched[0]!.ruleVersion,
      ...(effects.priorityReason ? { reason: effects.priorityReason } : {}),
    },
  );

  for (const refusal of outcome.refused) {
    logger.warn('a rule effect was refused', { event, what: refusal.what, why: refusal.why });
  }

  for (const notification of effects.notifications) {
    await notificationService.queueFromRule(ctx, tx, {
      ticketId,
      template: notification.template,
      to: notification.to,
      eventId,
      ruleKey: decision.matched.map((m) => m.ruleKey).join(','),
    });
  }

  await recordApplications(ctx, tx, decision, event, ticketId);
}

defineHandler({
  consumer: 'rules',
  moduleId: 'MOD-06',
  eventType: 'ticket.created',
  required: false,
  async handle(ctx, event, tx) {
    const { ticketId } = event.payload as { ticketId: string };
    await runRules(ctx, tx, 'ticket.created', ticketId, event.id);
  },
});

defineHandler({
  consumer: 'rules',
  moduleId: 'MOD-06',
  eventType: 'ticket.updated',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string };
    // A rule's own write publishes `ticket.updated` too, with `workflow` as the
    // actor. Without this guard a rule whose condition its own action satisfies
    // would re-trigger itself until the queue gave up.
    if (event.actor.type === 'workflow') return;
    await runRules(ctx, tx, 'ticket.updated', payload.ticketId, event.id);
  },
});

defineHandler({
  consumer: 'rules',
  moduleId: 'MOD-06',
  eventType: 'ticket.comment.added',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string; visibility: string; authorId: string | null };
    await runRules(ctx, tx, 'ticket.comment.added', payload.ticketId, event.id, {
      comment: { visibility: payload.visibility, authorId: payload.authorId },
    });
  },
});

defineHandler({
  consumer: 'rules',
  moduleId: 'MOD-06',
  eventType: 'ticket.status.changed',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string };
    if (event.actor.type === 'workflow') return;
    await runRules(ctx, tx, 'ticket.status.changed', payload.ticketId, event.id);
  },
});
