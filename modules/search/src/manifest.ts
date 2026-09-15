import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-09 Knowledge, search and AI.
 *
 * PH-1 delivered the search projection and its indexer. PH-3 adds Meilisearch
 * behind the same interface (ADR-0017, closing OD-02): the projection stays,
 * because it is written in the change's own transaction and is therefore the
 * one backend that can never be stale, and it is what search falls back to when
 * the engine is unreachable. The governed AI service arrives in PH-4.
 */
export const searchManifest: ModuleManifest = registerModule({
  id: 'MOD-09',
  key: 'search',
  name: 'Knowledge, search and AI assistance',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-04', 'MOD-14'],
  permissions: [{ key: 'search.query', scopes: ['own', 'team', 'any'], description: 'Search across the platform.' }],
  events: {
    publishes: ['search.document.indexed'],
    consumes: ['ticket.created', 'ticket.updated', 'ticket.status.changed', 'search.document.indexed'],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    { name: 'search.reindex', queue: 'search', description: 'Rebuild the external index for one tenant from the projection.' },
  ],
  routesPrefix: '/search',
  enabledByDefault: true,
  optional: false,
});
