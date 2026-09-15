import { type TenantContext, transaction } from '@itsm/platform';
import type { SearchBackend, SearchQuery, SearchResult, Visibility } from './types.js';

/**
 * Search served from the `search_document` projection (ADR-0017).
 *
 * This is the backend the platform started with and the one it falls back to,
 * so it is not a legacy path: the projection is written in the same transaction
 * as the change it describes, which makes it the only backend that can never be
 * stale relative to the database. Meilisearch is faster and more forgiving;
 * this one is always right.
 *
 * The visibility predicate is applied in the same statement as the match, so
 * ranking, counting and paging all operate on the set the caller may see — a
 * result count filtered afterwards would leak how much exists.
 */
export const postgresBackend: SearchBackend = {
  name: 'postgres',

  async healthy() {
    return true;
  },

  async query(ctx: TenantContext, options: SearchQuery, visibility: Visibility): Promise<SearchResult> {
    const query = options.query.trim();
    if (query.length === 0) return { hits: [], facetCounts: {}, engine: 'postgres' };

    return transaction(ctx, async (tx) => {
      const types = options.types?.length ? options.types : null;
      const facetFilter = buildFacetFilter(options.filters);

      const rows = await tx.$queryRaw<
        { entity_type: string; entity_id: string; title: string; snippet: string; rank: number; facets: unknown }[]
      >`
        SELECT
          entity_type,
          entity_id,
          title,
          ts_headline('simple', body_text, websearch_to_tsquery('simple', ${query}), 'MaxWords=25,MinWords=10') AS snippet,
          ts_rank(body_tsv, websearch_to_tsquery('simple', ${query})) AS rank,
          facets
        FROM search_document
        WHERE body_tsv @@ websearch_to_tsquery('simple', ${query})
          AND (${types}::text[] IS NULL OR entity_type = ANY(${types}::text[]))
          AND (${facetFilter}::jsonb IS NULL OR facets @> ANY(
            SELECT jsonb_array_elements(${facetFilter}::jsonb)
          ))
          AND (
            ${visibility.scope === 'any'}
            OR (acl->>'everyone')::boolean = true
            OR (acl->>'tenantWide')::boolean = true AND ${visibility.scope === 'team'}
            OR acl->'userIds' ? ${visibility.userId}
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(acl->'teamIds') AS t(team)
              WHERE t.team = ANY(${visibility.teamIds}::text[])
            )
            OR (acl->>'orgId') = ANY(${visibility.organisationIds}::text[])
          )
        ORDER BY rank DESC, source_updated_at DESC
        LIMIT ${options.limit}
      `;

      const hits = rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        snippet: row.snippet,
        rank: Number(row.rank),
        facets: (row.facets ?? {}) as Record<string, unknown>,
      }));

      return { hits, facetCounts: countFacets(hits, options.facetsToCount ?? []), engine: 'postgres' };
    });
  },

  // The projection rows are written by `indexDocument` inside the change's own
  // transaction, so there is nothing for this backend to push or delete
  // separately. Saying so explicitly beats an empty method with no explanation.
  async put() {
    /* written transactionally by indexDocument */
  },
  async remove() {
    /* removed transactionally by removeDocument */
  },
  async dropTenant() {
    /* rows are tenant-scoped and removed by purgeTenant */
  },
};

/**
 * Facet filters as a JSON array of single-key objects, matched with `@>`.
 *
 * Several values for one facet mean "any of", which is what a filter sidebar
 * does; several facets mean "all of". Returning null when there is nothing to
 * filter keeps the query planner on the same path as an unfiltered search.
 */
function buildFacetFilter(filters: Record<string, string[]> | undefined): string | null {
  if (!filters) return null;
  const clauses = Object.entries(filters).flatMap(([field, values]) =>
    values.map((value) => ({ [field]: value })),
  );
  return clauses.length > 0 ? JSON.stringify(clauses) : null;
}

/**
 * Counts facet values over the hits.
 *
 * Honest about its limit: these are counts across the page, not across
 * everything that matched, because PostgreSQL would need a second aggregate
 * query to do better. Meilisearch returns true counts. The UI shows counts
 * either way, so the difference is visible in the `engine` field rather than
 * pretended away.
 */
function countFacets(
  hits: { facets: Record<string, unknown> }[],
  fields: string[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const field of fields) {
    const counts: Record<string, number> = {};
    for (const hit of hits) {
      const value = hit.facets[field];
      if (typeof value !== 'string') continue;
      counts[value] = (counts[value] ?? 0) + 1;
    }
    out[field] = counts;
  }
  return out;
}
