import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-21 Tenancy. In PH-1 only the tenant model and provisioning are built. */
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
  ],
  events: { publishes: ['tenant.created', 'tenant.suspended'], consumes: [] },
  featureFlags: [],
  settings: [],
  jobs: [],
  routesPrefix: '/tenant',
  enabledByDefault: true,
  optional: false,
});
