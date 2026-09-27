import { registerNotificationPack } from '@itsm/module-notifications';

/**
 * How the AI service reaches the people who can do something about it.
 *
 * The audience is on each event — the tenant's administrators, resolved when
 * it happened — because a rule written in advance cannot know who they are.
 * Both go to the console and to email: each says something has already
 * changed about how the desk works, and neither should wait for somebody to
 * open the right page.
 */
registerNotificationPack({
  templates: [
    {
      key: 'ai.decision.stepped_down',
      subject: 'AI {{payload.purpose}} has switched itself from auto back to suggest',
      body:
        'Hello {{recipient.displayName}},\n\n' +
        'Agents corrected {{payload.overridden}} of the last {{payload.window}} values AI {{payload.purpose}} set by itself, ' +
        'which is more than the 5% it is allowed. So it has stopped setting anything by itself and gone back to suggest: ' +
        'agents now see its answers and choose whether to accept them.\n\n' +
        'Nothing it already set has been changed back. The AI triage page shows which fields were corrected. ' +
        'When you are satisfied it is right often enough again, auto can be switched back on under Configuration.',
    },
    {
      key: 'ai.budget.warned',
      subject: 'This month’s AI budget is nearly spent',
      body:
        'Hello {{recipient.displayName}},\n\n' +
        'AI spending for {{payload.periodKey}} has reached {{payload.spentPence}}p against a warning line of {{payload.limitPence}}p.\n\n' +
        'Nothing has been refused yet. If spending reaches the budget, AI suggestions stop and triage leaves new tickets as they arrived until the month ends or the budget is raised.',
    },
    {
      key: 'ai.budget.blocked',
      subject: 'This month’s AI budget has been spent',
      body:
        'Hello {{recipient.displayName}},\n\n' +
        'AI spending for {{payload.periodKey}} has reached the budget of {{payload.limitPence}}p.\n\n' +
        'Until the month ends or the budget is raised, AI suggestions are refused and triage leaves new tickets as they arrived. Everything else keeps working.',
    },
  ],
  rules: [
    {
      key: 'ai.decision.stepped_down.admins',
      eventType: 'ai.decision.stepped_down',
      templateKey: 'ai.decision.stepped_down',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
    },
    // `ai.budget.threshold` has been published since the budget was built,
    // and nothing delivered it.
    {
      key: 'ai.budget.warned.admins',
      eventType: 'ai.budget.threshold',
      templateKey: 'ai.budget.warned',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
      conditions: { eq: [{ var: 'payload.threshold' }, 'warned'] },
    },
    {
      key: 'ai.budget.blocked.admins',
      eventType: 'ai.budget.threshold',
      templateKey: 'ai.budget.blocked',
      audience: [{ kind: 'payload', path: 'audience' }],
      channels: ['inapp', 'email'],
      conditions: { eq: [{ var: 'payload.threshold' }, 'blocked'] },
    },
  ],
});
