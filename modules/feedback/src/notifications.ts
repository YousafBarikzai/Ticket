import { registerNotificationPack } from '@itsm/module-notifications';

/**
 * The ask, by email and in the inbox. The audience is whoever the event names
 * — the recipient — through MOD-11's `payload` descriptor, and the body carries
 * the signed link, which is the whole of the credential.
 */
registerNotificationPack({
  templates: [
    {
      key: 'survey.invited',
      subject: 'How did we do with {{payload.ticketNumber}}?',
      body: 'Hello {{recipient.displayName}},\n\nYour ticket {{payload.ticketNumber}} has been resolved. Would you tell us how it went? It takes a moment:\n\n{{payload.surveyUrl}}\n\nThe link works until {{payload.expiresAt}}.',
    },
  ],
  rules: [
    {
      key: 'survey.invited.recipient',
      eventType: 'survey.invited',
      templateKey: 'survey.invited',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
    },
  ],
});
