import { registerNotificationPack } from '@itsm/module-notifications';

/**
 * How a finished report reaches people.
 *
 * The rule's audience is "whatever the event says" — the `payload` kind that
 * MOD-11 resolves from the event's own `audience` field — because a scheduled
 * report knows who asked for it and a rule written in advance cannot. The
 * template is plain text with a link, which is what an email client and the
 * in-app inbox both render the same way.
 */
registerNotificationPack({
  templates: [
    {
      key: 'report.generated',
      subject: 'Your report is ready: {{payload.name}}',
      body: 'Hello {{recipient.displayName}},\n\n{{payload.name}} has run for {{payload.periodFrom}} to {{payload.periodTo}}.\n\n{{payload.summary}}\n\nDownload the full report as CSV: {{payload.downloadUrl}}',
    },
  ],
  rules: [
    {
      key: 'report.generated.audience',
      eventType: 'report.generated',
      templateKey: 'report.generated',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
    },
  ],
});
