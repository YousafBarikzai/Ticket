import { defineHandler } from '@itsm/platform';
import { notifyForEvent } from '../service/notification-service.js';

import { NOTIFYING_EVENTS } from '../domain/notifying-events.js';

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
