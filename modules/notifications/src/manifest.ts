import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-11 Notifications. In PH-1: rules from events, templates, in-app inbox and email. */
export const notificationsManifest: ModuleManifest = registerModule({
  id: 'MOD-11',
  key: 'notifications',
  name: 'Notifications, collaboration and communications',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-01', 'MOD-14'],
  permissions: [
    { key: 'notification.read', scopes: ['own'], description: 'Read your own in-app inbox.' },
    { key: 'notification.template.manage', scopes: ['any'], description: 'Manage templates and rules.' },
    { key: 'notification.delivery.read', scopes: ['any'], description: 'See delivery attempts and failures.' },
  ],
  events: {
    publishes: ['notification.queued', 'notification.sent', 'notification.failed'],
    consumes: [
      'ticket.created',
      'ticket.status.changed',
      'ticket.assigned',
      'ticket.comment.added',
      'sla.timer.warning',
      'sla.timer.breached',
      'report.generated',
      'survey.invited',
      'budget.threshold.reached',
    ],
  },
  featureFlags: [],
  settings: [
    {
      key: 'notification.email.enabled',
      schema: z.boolean(),
      default: true,
      scopes: ['tenant'],
      description: 'Send email notifications. Off in sandboxes that must not reach real inboxes.',
    },
  ],
  jobs: [{ name: 'notification.dispatch', queue: 'notify', description: 'Deliver one notification on one channel.' }],
  routesPrefix: '/notifications',
  enabledByDefault: true,
  optional: false,
});
