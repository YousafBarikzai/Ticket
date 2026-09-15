/** MOD-09 Knowledge, search and AI (search slice) — public interface. */
export { searchManifest } from './manifest.js';
export * as searchService from './service/search-service.js';
export {
  search,
  searchWithFacets,
  indexDocument,
  removeDocument,
  reindexTenant,
  aclForTicket,
  visibilityFor,
  type SearchHit,
  type SearchResult,
  type DocumentAcl,
} from './service/search-service.js';
export {
  externalBackend,
  resetBackend,
  postgresBackend,
  createMeilisearchBackend,
  indexNameFor,
  buildFilter,
  documentKey,
  type SearchBackend,
  type Visibility,
} from './backend/index.js';
import './handlers/index.js';
import './jobs/reindex.js';
import './purge.js';
