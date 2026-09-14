import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-09 Knowledge, search and AI — PH-1 slice only: the search projection and
 * its indexer. Knowledge arrives in PH-2 and the governed AI service in PH-4.
 */
export const searchManifest: ModuleManifest = registerModule({
  id: 'MOD-09',
  key: 'search',
  name: 'Knowledge, search and AI assistance',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-04', 'MOD-14'],
  permissions: [{ key: 'search.query', scopes: ['own', 'team', 'any'], description: 'Search across the platform.' }],
  events: { publishes: ['search.document.indexed'], consumes: ['ticket.created', 'ticket.updated', 'ticket.status.changed'] },
  featureFlags: [],
  settings: [],
  jobs: [{ name: 'search.reindex', queue: 'search', description: 'Rebuild the projection for one entity type.' }],
  routesPrefix: '/search',
  enabledByDefault: true,
  optional: false,
});
