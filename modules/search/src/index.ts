/** MOD-09 Knowledge, search and AI (PH-1 search slice) — public interface. */
export { searchManifest } from './manifest.js';
export * as searchService from './service/search-service.js';
export { search, indexDocument, aclForTicket, type SearchHit, type DocumentAcl } from './service/search-service.js';
import './handlers/index.js';
