import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-14 Integrations, API and developer platform. Owns the outbox and webhooks. */
export const integrationsManifest: ModuleManifest = registerModule({
  id: 'MOD-14',
  key: 'integrations',
  name: 'Integrations, API and developer platform',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-01', 'MOD-15'],
  permissions: [
    { key: 'webhook.read', scopes: ['any'], description: 'See webhook subscriptions and deliveries.' },
    { key: 'webhook.manage', scopes: ['any'], description: 'Create and change webhook subscriptions.' },
    { key: 'integration.log.read', scopes: ['any'], description: 'Read integration logs.' },
    {
      key: 'integration.credential.read',
      scopes: ['any'],
      description: 'See which credentials exist, never their values.',
    },
    {
      key: 'integration.credential.manage',
      scopes: ['any'],
      description: 'Store, rotate and delete credentials.',
    },
    { key: 'integration.action.read', scopes: ['any'], description: 'See actions and the error queue.' },
    { key: 'integration.action.manage', scopes: ['any'], description: 'Write and publish actions.' },
    {
      key: 'integration.action.replay',
      scopes: ['any'],
      description: 'Replay or dismiss a failed action. Separate from managing them: a replay makes a real call.',
    },
  ],
  events: { publishes: ['integration.webhook.delivery.failed'], consumes: [] },
  featureFlags: [],
  settings: [],
  jobs: [
    { name: 'outbox.publish', queue: 'outbox', schedule: '* * * * *', description: 'Move outbox events onto the bus.' },
    { name: 'outbox.reconcile', queue: 'reconcile', schedule: '* * * * *', description: 'Re-enqueue events no required consumer acknowledged.' },
    { name: 'webhook.deliver', queue: 'webhooks', description: 'Deliver one signed webhook.' },
    { name: 'event.dispatch', queue: 'events', description: 'Run one consumer against one event.' },
  ],
  routesPrefix: '/webhooks',
  enabledByDefault: true,
  optional: false,
});
