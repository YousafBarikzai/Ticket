import { defineJob } from '@itsm/platform';
import { postToChat } from '../service/invitation-service.js';

/** Posts one invitation into its ticket's chat thread. Enqueued per invitation. */
defineJob<{ invitationId: string }>('channels', 'survey.chat.post', async (payload, { ctx }) => {
  await postToChat(ctx, payload.invitationId);
});
