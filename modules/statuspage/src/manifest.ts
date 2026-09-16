import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-23 Status page. What the public is told, kept as the desk's own record
 * rather than a view over the incident it describes.
 */
export const statusPageManifest: ModuleManifest = registerModule({
  id: 'MOD-23',
  key: 'statuspage',
  name: 'Status page',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-08-E1', 'MOD-08-E3', 'MOD-05', 'MOD-11', 'MOD-21'],
  permissions: [
    { key: 'statuspage.read', scopes: ['any'], description: 'See the status page as an operator: subscribers, drafts, history.' },
    { key: 'statuspage.manage', scopes: ['any'], description: 'Edit the page, its components, incidents and maintenance.' },
  ],
  events: {
    publishes: ['status.incident.updated', 'status.maintenance.scheduled'],
    consumes: ['incident.major.declared', 'incident.major.updated', 'incident.major.resolved', 'change.scheduled', 'change.closed'],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: 'status.maintenance.sweep',
      queue: 'notify',
      // Every five minutes: a window that opened at 02:00 shows as in progress
      // by 02:05, and the components it covers say so.
      schedule: '*/5 * * * *',
      description: 'Move maintenance windows through scheduled, in progress and completed by the clock.',
    },
    {
      name: 'status.notify',
      queue: 'notify',
      description: 'Tell confirmed subscribers about one update or one maintenance notice.',
    },
  ],
  routesPrefix: '/status',
  enabledByDefault: true,
  optional: true,
});
