import { defineHandler } from '@itsm/platform';
import { notifyForEvent } from '../service/notification-service.js';

/**
 * MOD-11 listens to everything its rules might act on. The rule table decides
 * what actually notifies, so adding a notification is configuration rather
 * than a code change.
 */
const NOTIFYING_EVENTS = [
  'ticket.created',
  'ticket.status.changed',
  'ticket.assigned',
  'ticket.comment.added',
  'sla.timer.warning',
  'sla.timer.breached',
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
