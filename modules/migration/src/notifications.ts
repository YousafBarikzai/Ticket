import { registerNotificationPack } from '@itsm/module-notifications';

/**
 * How a finished import reaches the person who started it. The audience is
 * on the event, because the job knows who asked and a rule written in
 * advance cannot. The counts are in the message: the point of the email is
 * to say whether to look at the failures before committing.
 */
registerNotificationPack({
  templates: [
    {
      key: 'import.job.finished',
      subject: 'Import {{payload.status}}: {{payload.name}}',
      body: 'Hello {{recipient.displayName}},\n\nYour {{payload.mode}} import of {{payload.entity}} from {{payload.source}} has {{payload.status}}.\n\nRows read: {{payload.seen}}\nCreated: {{payload.created}}\nUpdated: {{payload.updated}}\nUnchanged: {{payload.unchanged}}\nFailed: {{payload.failed}}\n\n{{payload.error}}\n\nOpen the job to see every row and why any failed.',
    },
  ],
  rules: [
    {
      key: 'import.job.finished.audience',
      eventType: 'import.job.finished',
      templateKey: 'import.job.finished',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
    },
  ],
});
