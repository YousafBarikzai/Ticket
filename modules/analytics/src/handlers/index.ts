import { defineHandler } from '@itsm/platform';
import { markBreached, refreshTicketFact } from '../service/ticket-projector.js';
import { refreshTimerFact } from '../service/sla-projector.js';
import { refreshApprovalFact } from '../service/approval-projector.js';
import { refreshTaskFact } from '../service/task-projector.js';
import { refreshNotificationFact } from '../service/notification-projector.js';

/**
 * MOD-12 consumes; it never publishes anything a person acts on directly, and
 * it never writes to another module's tables. That asymmetry is the whole
 * point: reporting can be rebuilt from scratch at any time because nothing
 * downstream depends on it having been right the first time.
 *
 * Every handler is `required`, so the reconciler re-enqueues an event this
 * consumer never acknowledged. A missed projection is not a missed
 * notification — nobody notices at the time — which is exactly why it has to
 * be the machine that notices.
 */

const consumer = 'analytics';
const moduleId = 'MOD-12';

for (const eventType of ['ticket.created', 'ticket.updated', 'ticket.status.changed', 'ticket.assigned', 'ticket.comment.added']) {
  defineHandler({
    consumer,
    moduleId,
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      const { ticketId } = event.payload as { ticketId: string };
      await refreshTicketFact(ctx, tx, event, ticketId);
    },
  });
}

for (const eventType of ['ticket.task.created', 'ticket.task.completed']) {
  defineHandler({
    consumer,
    moduleId,
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      const { taskId } = event.payload as { taskId: string };
      await refreshTaskFact(ctx, tx, event, taskId);
    },
  });
}

for (const eventType of ['sla.timer.started', 'sla.timer.paused', 'sla.timer.resumed', 'sla.timer.met']) {
  defineHandler({
    consumer,
    moduleId,
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      const { timerId } = event.payload as { timerId: string };
      await refreshTimerFact(ctx, tx, event, timerId);
    },
  });
}

defineHandler({
  consumer,
  moduleId,
  eventType: 'sla.timer.breached',
  required: true,
  async handle(ctx, event, tx) {
    const payload = event.payload as { timerId: string; ticketId: string };
    await refreshTimerFact(ctx, tx, event, payload.timerId);
    // The ticket carries the flag as well as the timer, because "how many of
    // last month's tickets breached" must not need a join to answer.
    await markBreached(ctx, tx, event, payload.ticketId);
  },
});

for (const eventType of ['approval.requested', 'approval.decided']) {
  defineHandler({
    consumer,
    moduleId,
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      const { requestId } = event.payload as { requestId: string };
      await refreshApprovalFact(ctx, tx, event, requestId);
    },
  });
}

for (const eventType of ['notification.queued', 'notification.sent', 'notification.failed']) {
  defineHandler({
    consumer,
    moduleId,
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      const payload = event.payload as { notificationId: string; channel: string };
      await refreshNotificationFact(ctx, tx, event, payload.notificationId, payload.channel);
    },
  });
}
