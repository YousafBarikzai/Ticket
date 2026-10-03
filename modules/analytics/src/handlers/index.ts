import { defineHandler, type EventHandler } from '@itsm/platform';
import { bumpQueryVersionFor } from '../service/query-cache.js';
import { markBreached, refreshTicketFact } from '../service/ticket-projector.js';
import { refreshTimerFact } from '../service/sla-projector.js';
import { refreshApprovalFact } from '../service/approval-projector.js';
import { refreshTaskFact } from '../service/task-projector.js';
import { refreshNotificationFact } from '../service/notification-projector.js';
import { refreshSurveyFact } from '../service/survey-projector.js';
import { refreshTimeFact } from '../service/time-projector.js';

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
 *
 * Every handler ends by moving the metric cache's version on (A8 R4c), so a
 * cached answer never outlives the facts it was computed from. It is the one
 * place a projection write happens, so it is the one place that has to
 * remember; `project` below is how none of them can forget.
 */

const consumer = 'analytics';
const moduleId = 'MOD-12';

/**
 * Registers a projection handler that bumps the cache version after its
 * writes. The bump is the handler's last statement, inside the dispatcher's
 * transaction; `query-cache.ts` explains why an answer read in the moment
 * before the commit is never kept.
 */
function project(eventType: string, write: EventHandler['handle']): void {
  defineHandler({
    consumer,
    moduleId,
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      await write(ctx, event, tx);
      await bumpQueryVersionFor(tx, ctx.tenantId);
    },
  });
}

for (const eventType of ['ticket.created', 'ticket.imported', 'ticket.updated', 'ticket.status.changed', 'ticket.assigned', 'ticket.comment.added']) {
  project(eventType, async (ctx, event, tx) => {
    const { ticketId } = event.payload as { ticketId: string };
    await refreshTicketFact(ctx, tx, event, ticketId);
  });
}

for (const eventType of ['ticket.task.created', 'ticket.task.completed']) {
  project(eventType, async (ctx, event, tx) => {
    const { taskId } = event.payload as { taskId: string };
    await refreshTaskFact(ctx, tx, event, taskId);
  });
}

// `restarted` moves an update timer's due time on to its next cycle, and
// `cancelled` takes a timer out of attainment altogether (F1, ADR-0057); both
// change the fact, so both refresh it.
for (const eventType of [
  'sla.timer.started',
  'sla.timer.paused',
  'sla.timer.resumed',
  'sla.timer.met',
  'sla.timer.restarted',
  'sla.timer.cancelled',
]) {
  project(eventType, async (ctx, event, tx) => {
    const { timerId } = event.payload as { timerId: string };
    await refreshTimerFact(ctx, tx, event, timerId);
  });
}

project('sla.timer.breached', async (ctx, event, tx) => {
  const payload = event.payload as { timerId: string; ticketId: string };
  await refreshTimerFact(ctx, tx, event, payload.timerId);
  // The ticket carries the flag as well as the timer, because "how many of
  // last month's tickets breached" must not need a join to answer.
  await markBreached(ctx, tx, event, payload.ticketId);
});

// `cancelled` settles an approval as withdrawn when its ticket ends
// (ADR-0059); the fact must say so, or it reads as pending for ever.
for (const eventType of ['approval.requested', 'approval.decided', 'approval.cancelled']) {
  project(eventType, async (ctx, event, tx) => {
    const { requestId } = event.payload as { requestId: string };
    await refreshApprovalFact(ctx, tx, event, requestId);
  });
}

for (const eventType of ['notification.queued', 'notification.sent', 'notification.failed']) {
  project(eventType, async (ctx, event, tx) => {
    const payload = event.payload as { notificationId: string; channel: string };
    await refreshNotificationFact(ctx, tx, event, payload.notificationId, payload.channel);
  });
}

project('survey.responded', async (ctx, event, tx) => {
  const { responseId } = event.payload as { responseId: string };
  await refreshSurveyFact(ctx, tx, event, responseId);
});

for (const eventType of ['time.entry.logged', 'time.entry.deleted']) {
  project(eventType, async (ctx, event, tx) => {
    const { entryId } = event.payload as { entryId: string };
    await refreshTimeFact(ctx, tx, event, entryId);
  });
}
