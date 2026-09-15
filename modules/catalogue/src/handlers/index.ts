import { defineHandler, logger } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';

/**
 * MOD-05 reacts to the approval its own request opened.
 *
 * A request waiting on an approval is not work the service desk can start, and
 * a rejected one is not work at all. Without this the ticket sits in the queue
 * looking actionable while the decision is still out, and stays there after a
 * rejection — which is how a refused request quietly gets fulfilled anyway.
 */
defineHandler({
  consumer: 'catalogue',
  moduleId: 'MOD-05',
  eventType: 'approval.decided',
  required: true,
  async handle(ctx, event, tx) {
    const payload = event.payload as {
      subjectType: string;
      ticketId: string | null;
      outcome: 'approved' | 'rejected';
    };
    if (payload.subjectType !== 'request' || !payload.ticketId) return;

    const outcome = await ticketService.applyAutomatedChange(
      ctx,
      tx,
      payload.ticketId,
      {
        status:
          payload.outcome === 'approved'
            ? { status: 'in_progress', reason: 'The approval was granted' }
            : { status: 'cancelled', reason: 'The approval was refused' },
        tags: [payload.outcome === 'approved' ? 'approved' : 'rejected'],
      },
      { kind: 'workflow', id: payload.ticketId, key: 'catalogue:approval', version: 1 },
    );

    for (const refusal of outcome.refused) {
      logger.warn('an approval outcome could not be applied to its request', {
        ticketId: payload.ticketId,
        what: refusal.what,
        why: refusal.why,
      });
    }
  },
});
