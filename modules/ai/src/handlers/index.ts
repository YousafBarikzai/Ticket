import { defineHandler, enqueue, logger, metrics } from '@itsm/platform';
import { triagesChannel } from '../domain/decisions.js';
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
