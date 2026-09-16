import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-18 Feedback. Surveys after an outcome: a ticket resolved, a request
 * fulfilled, a major incident over. Built on MOD-02's form contract for the
 * questions, MOD-11 for the ask, MOD-03 for asking in the thread the person is
 * already in, and MOD-12 for what the answers add up to.
 */
export const feedbackManifest: ModuleManifest = registerModule({
  id: 'MOD-18',
  key: 'feedback',
  name: 'Feedback and surveys',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-11', 'MOD-03'],
  permissions: [
    { key: 'feedback.read', scopes: ['team', 'any'], description: 'See survey responses and who has been asked.' },
    { key: 'feedback.manage', scopes: ['any'], description: 'Design surveys, publish them and decide what sends them.' },
  ],
  events: {
    publishes: ['survey.invited', 'survey.responded'],
    consumes: ['ticket.status.changed', 'incident.major.resolved'],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: 'feedback.expiry.sweep',
      queue: 'retention',
      // Overnight: an invitation that lapsed at 14:00 is expired by morning,
      // and nobody is waiting on the minute.
      schedule: '10 3 * * *',
      description: 'Mark invitations past their expiry so the link says so rather than failing.',
    },
    {
      name: 'survey.chat.post',
      queue: 'channels',
      description: 'Post a survey into the chat thread a ticket lives in.',
    },
  ],
  routesPrefix: '/surveys',
  enabledByDefault: true,
  optional: true,
});
