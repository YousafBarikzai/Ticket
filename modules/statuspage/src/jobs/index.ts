import { defineJob } from '@itsm/platform';
import { notifySubscribers } from '../service/public-service.js';

/**
 * Tells confirmed subscribers about one line on the page. Enqueued per
 * update and per maintenance status change, from inside the transaction that
 * wrote the row; runs after it commits, on the comms queue, where a slow mail
 * server delays nothing but other mail.
 */
defineJob<{ updateId?: string; maintenanceId?: string; status?: string }>('notify', 'status.notify', async (payload, { ctx }) => {
  await notifySubscribers(ctx, payload);
});
