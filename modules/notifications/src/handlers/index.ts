import { defineHandler } from '@itsm/platform';
import { notifyForEvent } from '../service/notification-service.js';

/**
 * MOD-11 listens to everything its rules might act on. The rule table decides
 * what actually notifies, so adding a notification is configuration rather
 * than a code change — for any event in this list.
 *
 * The list is the catch: a rule for an event type not named here is accepted
 * and never fires, silently. Handlers are registered at import and the rule
 * table is read per tenant at run time, so the list cannot be derived from the
 * rules; it can only be kept honest, which the manifest's `consumes` and a
 * seeded rule's `eventType` both help with. Found when MOD-12's
 * `report.generated` rule was seeded and its integration test asked where the
 * notification was.
 */
const NOTIFYING_EVENTS = [
  'ticket.created',
  'ticket.status.changed',
  'ticket.assigned',
  'ticket.comment.added',
  'sla.timer.warning',
  'sla.timer.breached',
  'report.generated',
  'survey.invited',
  'budget.threshold.reached',
] as const;

for (const eventType of NOTIFYING_EVENTS) {
  defineHandler({
    consumer: 'notifications',
    moduleId: 'MOD-11',
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      await notifyForEvent(ctx, event, tx);
    },
  });
}
