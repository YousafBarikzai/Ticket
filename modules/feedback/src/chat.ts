import { registerChatAction } from '@itsm/module-channels';
import { respondFromChat } from './service/response-service.js';

/**
 * Rating from the thread. A button carries `{ invitationId, value }`; a typed
 * reply while the thread is waiting carries the value as text. Either way the
 * sender has to be the person the survey was sent to.
 */
registerChatAction('survey', {
  async onAction(data, context) {
    const invitationId = typeof data.invitationId === 'string' ? data.invitationId : null;
    const value = typeof data.value === 'number' ? data.value : Number(data.value);
    if (!invitationId || !Number.isFinite(value)) return { reply: 'That button did not carry an answer.' };
    return respondFromChat(context.ctx, context.tx, invitationId, value, context.identity?.userId ?? null, context.parsed.channel);
  },
  async onText(text, data, context) {
    const match = /^\s*(\d{1,2})\s*$/.exec(text);
    if (!match) return null;
    const invitationId = typeof data.invitationId === 'string' ? data.invitationId : null;
    if (!invitationId) return null;
    return respondFromChat(context.ctx, context.tx, invitationId, Number(match[1]), context.identity?.userId ?? null, context.parsed.channel);
  },
});
