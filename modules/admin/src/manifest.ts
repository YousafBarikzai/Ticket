import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-13 Administration. Owns the settings framework every other module uses. */
export const adminManifest: ModuleManifest = registerModule({
  id: 'MOD-13',
  key: 'admin',
  name: 'Administration, configuration and module marketplace',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-01', 'MOD-15'],
  permissions: [
    { key: 'admin.setting.read', scopes: ['any'], description: 'Read configuration.' },
    { key: 'admin.setting.manage', scopes: ['any'], description: 'Publish and roll back configuration.' },
    { key: 'admin.flag.manage', scopes: ['any'], description: 'Override feature flags.' },
    { key: 'admin.module.manage', scopes: ['any'], description: 'Enable and disable modules for this tenant.' },
    { key: 'admin.activity.read', scopes: ['any'], description: 'Read the admin activity log.' },
  ],
  events: { publishes: ['config.published', 'config.rolled_back', 'module.enabled', 'module.disabled'], consumes: ['tenant.created'] },
  featureFlags: [],
  settings: [],
  jobs: [],
  routesPrefix: '/settings',
  enabledByDefault: true,
  optional: false,
});
