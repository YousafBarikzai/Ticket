import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-21 Tenancy, and from PH-4 the plans, limits and meters it charges on. */
export const tenancyManifest: ModuleManifest = registerModule({
  id: 'MOD-21',
  key: 'tenancy',
  name: 'Tenancy, licensing and billing',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: [],
  permissions: [
    { key: 'tenant.read', scopes: ['any'], description: 'Read the current tenant and its organisations.' },
    { key: 'tenant.org.manage', scopes: ['any'], description: 'Create and change organisations.' },
    { key: 'platform.tenant.manage', scopes: ['any'], description: 'Provision, suspend and delete tenants (platform operators).' },
    { key: 'platform.plan.manage', scopes: ['any'], phase: 'PH-4', description: 'Define plans and their limits, and move a tenant between them (platform operators).' },
    { key: 'tenant.usage.read', scopes: ['any'], phase: 'PH-4', description: 'See what this tenant is using against its plan.' },
    { key: 'tenant.limit.manage', scopes: ['any'], phase: 'PH-4', description: 'Set this tenant\'s own warning thresholds. Never its hard limits.' },
  ],
  events: {
    publishes: ['tenant.created', 'tenant.suspended', 'usage.limit.reached', 'plan.changed'],
    consumes: ['ticket.created', 'ticket.attachment.added', 'user.provisioned', 'user.deactivated', 'role.assignment.changed'],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: 'usage.recompute',
      queue: 'retention',
      // Early, and after MOD-12's rollup: both rebuild a number from the
      // rows beneath it, and a night where they disagree is worth seeing.
      schedule: '10 2 * * *',
      description: 'Fan out a meter rebuild, one job per active tenant.',
    },
    {
      name: 'usage.recompute.tenant',
      queue: 'retention',
      description: 'Rebuild one tenant\'s meters from the rows that define them.',
    },
    {
      name: 'usage.flush',
      queue: 'retention',
      // Every minute: a figure a minute behind is fine for a limit, and a
      // write per request is not fine for anything.
      schedule: '* * * * *',
      description: 'Write the buffered API-call counts into the meters.',
    },
  ],
  routesPrefix: '/tenant',
  enabledByDefault: true,
  optional: false,
});
