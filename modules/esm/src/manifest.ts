import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-22 Enterprise service management packs.
 *
 * Stands a non-IT desk up in one action: the services it offers, the forms
 * its requests are raised on, the workflow that fulfils them, the SLA it
 * answers to and the article that explains it — all written through the
 * modules that own them, so a pack leaves behind ordinary configuration and
 * nothing this module has to keep running.
 */
export const esmManifest: ModuleManifest = registerModule({
  id: 'MOD-22',
  key: 'esm',
  name: 'Enterprise service management packs',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-01', 'MOD-05', 'MOD-06', 'MOD-07', 'MOD-09', 'MOD-13', 'MOD-15'],
  permissions: [
    { key: 'pack.read', scopes: ['any'], description: 'See the packs this deployment ships and what this tenant installed.' },
    { key: 'pack.install', scopes: ['any'], description: 'Install a pack, and take or decline a newer version of one.' },
  ],
  events: {
    publishes: ['pack.installed', 'pack.upgraded'],
    consumes: ['request.submitted'],
  },
  featureFlags: [],
  settings: [],
  jobs: [],
  routesPrefix: '/packs',
  enabledByDefault: true,
  optional: true,
});
