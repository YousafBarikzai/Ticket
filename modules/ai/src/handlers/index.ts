import { defineHandler, enqueue, logger, metrics, type TenantContext } from '@itsm/platform';
import { triagesChannel } from '../domain/decisions.js';
import { recordOverrides } from '../service/auto-service.js';
import { modeFor, settleDecisions } from '../service/decision-service.js';

/**
 * Shadow triage follows the ticket lifecycle (ADR-0051).
 *
 * Neither handler is required: a decision is evidence for later, and losing
 * one is a gap in a chart. Each consumer runs in its own transaction, so a
 * failure here never touches the ticket or any other module's handling of the
 * same event.
 */

defineHandler({
  consumer: 'ai',
  moduleId: 'MOD-09-AI',
  eventType: 'ticket.created',
  required: false,
  async handle(ctx, event) {
    const { ticketId, channel } = event.payload as { ticketId: string; channel: string };
    if (!triagesChannel(channel)) return;
    try {
      // Checked here as well as in the job, so a tenant with triage off does
      // not put a job on the queue for every ticket it receives.
      if ((await modeFor(ctx, 'triage')) === 'off') return;
      // Keyed by ticket, so a redelivered event cannot triage it twice. No
      // colon: the queue refuses one in an id.
      await enqueue(ctx, 'ai', 'ai.decide', { purpose: 'triage', ticketId }, { idempotencyKey: `triage-${ticketId}` });
      metrics.increment('ai_decisions_queued_total', { purpose: 'triage' });
    } catch (error) {
      metrics.increment('ai_decisions_not_queued_total', { purpose: 'triage' });
      logger.warn('shadow triage was not queued for a new ticket', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

defineHandler({
  consumer: 'ai',
  moduleId: 'MOD-09-AI',
  eventType: 'ticket.status.changed',
  required: false,
  async handle(ctx, event, tx) {
    const { ticketId, toCategory } = event.payload as { ticketId: string; toCategory: string };
    // Scored against what the ticket was resolved as: by then the people
    // working it have had every chance to re-route it. A reopened ticket that
    // is resolved again is settled again, on the later answer.
    //
    // Not caught, unlike the handler above: this one writes inside the
    // event's transaction, and a statement that failed there has already
    // spoiled it. It is two indexed statements, and cheap to retry.
    if (toCategory !== 'resolved') return;
    await settleDecisions(ctx, tx, ticketId);
  },
});

/**
 * Asks whether `auto` should step down, off the transaction that recorded the
 * correction: the step-down writes a setting and clears its cache, and the
 * cache must only be cleared once the new value is committed.
 */
async function askForReview(ctx: TenantContext): Promise<void> {
  try {
    await enqueue(ctx, 'ai', 'ai.decision.review', { purpose: 'triage' });
  } catch (error) {
    // Not a statement, so the transaction is untouched. The next correction
    // asks again, and the page shows the meter either way.
    logger.warn('the auto step-down review was not queued', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A person changing what `auto` set is a correction (ADR-0051).
 *
 * Only people: actor `user`. The AI's own write comes back as a
 * `ticket.updated` from actor `ai`, and a rule reacting to it as `workflow`;
 * neither is anybody disagreeing. Written in the event's transaction, like
 * settling, and not caught for the same reason.
 */
defineHandler({
  consumer: 'ai',
  moduleId: 'MOD-09-AI',
  eventType: 'ticket.updated',
  required: false,
  async handle(ctx, event, tx) {
    if (event.actor.type !== 'user') return;
    const { ticketId, changed } = event.payload as { ticketId: string; changed: Record<string, { after: unknown }> };
    if (!('categoryId' in changed) && !('groupId' in changed)) return;
    const after = Object.fromEntries(Object.entries(changed).map(([field, change]) => [field, change.after]));
    if (await recordOverrides(ctx, tx, ticketId, after)) await askForReview(ctx);
  },
});

defineHandler({
  consumer: 'ai',
  moduleId: 'MOD-09-AI',
  eventType: 'ticket.assigned',
  required: false,
  async handle(ctx, event, tx) {
    if (event.actor.type !== 'user') return;
    // Every assignment names the group, changed or not; a group the AI set
    // that is still the group is not a correction, and `overrides` says so.
    const { ticketId, groupId } = event.payload as { ticketId: string; groupId: string | null };
    if (await recordOverrides(ctx, tx, ticketId, { groupId })) await askForReview(ctx);
  },
});
