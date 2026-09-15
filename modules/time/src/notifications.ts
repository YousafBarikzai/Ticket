import { registerNotificationPack } from '@itsm/module-notifications';

/** A budget line crossed, to the budget's owner. */
registerNotificationPack({
  templates: [
    {
      key: 'budget.threshold.reached',
      subject: 'Budget {{payload.name}}: {{payload.threshold}} % reached',
      body: 'Hello {{recipient.displayName}},\n\nSpend against {{payload.name}} has reached {{payload.threshold}} % of its {{payload.amount}} {{payload.currency}} for the period {{payload.periodStart}} to {{payload.periodEnd}}: {{payload.spent}} {{payload.currency}} so far.',
    },
  ],
  rules: [
    {
      key: 'budget.threshold.owner',
      eventType: 'budget.threshold.reached',
      templateKey: 'budget.threshold.reached',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
    },
  ],
});
