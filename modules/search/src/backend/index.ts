import { loadConfig, logger, metrics } from '@itsm/platform';
import { createMeilisearchBackend } from './meilisearch.js';
import { postgresBackend } from './postgres.js';
import type { SearchBackend } from './types.js';

export * from './types.js';
export { postgresBackend } from './postgres.js';
export { createMeilisearchBackend, indexNameFor, buildFilter } from './meilisearch.js';

let external: SearchBackend | null | undefined;

/**
 * The external engine, if one is configured. `null` means PostgreSQL only,
 * which is a supported way to run the platform and not a degraded one — a small
 * tenant does not need a search server.
 */
export function externalBackend(): SearchBackend | null {
  if (external !== undefined) return external;
  const config = loadConfig();
  external = config.MEILISEARCH_URL
    ? createMeilisearchBackend({ url: config.MEILISEARCH_URL, apiKey: config.MEILISEARCH_API_KEY })
    : null;
  return external;
}

/** Test helper: forget the resolved backend so configuration can change. */
export function resetBackend(): void {
  external = undefined;
}

/**
 * Which backend should answer a query.
 *
 * Meilisearch when it is configured and reachable; PostgreSQL otherwise. The
 * fallback is safe to take at any moment precisely because the projection is
 * written in the change's own transaction and never removed: it is always
 * current, so a search engine falling over degrades typo tolerance and facet
 * counts rather than search.
 *
 * The chosen engine is returned to the caller in every result, so a degraded
 * answer is visible in the response and in the metric rather than being
 * indistinguishable from a healthy one.
 */
export async function backendForQuery(): Promise<SearchBackend> {
  const candidate = externalBackend();
  if (!candidate) return postgresBackend;
  if (await candidate.healthy()) return candidate;

  metrics.increment('search_backend_fallback_total', { from: candidate.name, to: 'postgres' });
  logger.warn('search engine is unreachable; answering from the PostgreSQL projection', { engine: candidate.name });
  return postgresBackend;
}
