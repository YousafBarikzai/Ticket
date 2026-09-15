import { defineHandler } from '@itsm/platform';
import { markAssigned } from '../service/routing-service.js';

/**
 * Manual assignments count towards everybody's turn too.
 *
 * Round robin reads when each agent was last given a ticket, and a team lead
 * handing one over by hand is exactly that. Without this the router would keep
 * offering work to somebody who has just been given three by their manager.
 *
 * Only `manual` is handled here: a routed assignment has already left its mark,
 * in the same transaction that made it, and counting it twice would push that
 * person to the back of a queue they have only had one ticket from.
 */
defineHandler({
  consumer: 'workload',
  moduleId: 'MOD-20',
  eventType: 'ticket.assigned',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { assigneeId: string | null; method?: string };
    if (!payload.assigneeId || payload.method !== 'manual') return;
    await markAssigned(tx, ctx, payload.assigneeId, new Date(event.occurredAt));
  },
});
