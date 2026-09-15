import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-19 Time and cost. What work took, what it cost, and whether that is
 * inside what was set aside for it. Feeds MOD-12, which is where the numbers
 * are looked at.
 */
export const timeManifest: ModuleManifest = registerModule({
  id: 'MOD-19',
  key: 'time',
  name: 'Time and cost',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-01', 'MOD-11'],
  permissions: [
    { key: 'time.log', scopes: ['own', 'team', 'any'], description: 'Record time against a ticket, and run a timer.' },
    { key: 'time.read', scopes: ['own', 'team', 'any'], description: 'See time and cost on tickets.' },
    { key: 'time.manage', scopes: ['any'], description: 'Define activity types, rates and budgets.' },
  ],
  events: {
    publishes: ['time.entry.logged', 'time.entry.deleted', 'budget.threshold.reached'],
    consumes: ['ticket.created', 'ticket.status.changed'],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: 'budget.sweep',
      queue: 'analytics',
      // After the rollups and before the day: a running total that drifted
      // during the day is corrected before anybody reads it.
      schedule: '40 1 * * *',
      description: 'Recompute every active budget\'s current period from the entries.',
    },
  ],
  routesPrefix: '/time',
  enabledByDefault: true,
  optional: true,
});
