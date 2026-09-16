import { registerNotificationPack } from '@itsm/module-notifications';

/**
 * How a limit reaches the people who can do something about it.
 *
 * The audience is on the event — the tenant's administrators, resolved when
 * the line was crossed — because a rule written in advance cannot know who
 * they are. Two templates, because the two messages have different jobs:
 * a warning asks somebody to look, and a refusal tells them what has
 * already stopped working and what has not.
 */
registerNotificationPack({
  templates: [
    {
      key: 'usage.limit.warned',
      subject: 'Approaching the {{payload.meter}} limit on the {{payload.planKey}} plan',
      body: 'Hello {{recipient.displayName}},\n\nThis tenant is at {{payload.value}} against a warning threshold of {{payload.limit}} for {{payload.meter}}.\n\nNothing has been refused. If the figure keeps climbing it will reach the plan\'s hard limit, and at that point new usage of this kind is refused until the plan changes.',
    },
    {
      key: 'usage.limit.reached',
      subject: 'The {{payload.meter}} limit on the {{payload.planKey}} plan has been reached',
      body: 'Hello {{recipient.displayName}},\n\nThis tenant has reached {{payload.limit}} for {{payload.meter}} and is now at {{payload.value}}.\n\nFrom now on the act that grows this figure is refused with a message naming the plan. Everything already here keeps working, and reading, resolving and closing are never refused. Moving to a larger plan clears it within a minute.',
    },
  ],
  rules: [
    {
      key: 'usage.limit.warned.admins',
      eventType: 'usage.limit.reached',
      templateKey: 'usage.limit.warned',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
      conditions: { eq: [{ var: 'payload.threshold' }, 'warned'] },
    },
    {
      key: 'usage.limit.reached.admins',
      eventType: 'usage.limit.reached',
      templateKey: 'usage.limit.reached',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
      conditions: { eq: [{ var: 'payload.threshold' }, 'blocked'] },
    },
  ],
});
