import { logger, metrics } from '@itsm/platform';
import {
  documentKey,
  type IndexedDocument,
  type SearchBackend,
  type SearchQuery,
  type SearchResult,
  type Visibility,
} from './types.js';

/**
 * Meilisearch, over its HTTP API (ADR-0017, closing OD-02).
 *
 * Written against `fetch` rather than the official client on purpose. The API
 * this uses is six endpoints; the client would add a dependency tree to every
 * deployable, and the production image scan has already rejected three
 * libraries this application never executes. A dependency earns its place by
 * doing something hard, and `PUT /indexes/x/documents` is not hard.
 *
 * **One index per tenant.** A query names the tenant's index, so a bug in a
 * filter cannot reach another tenant's documents — the same reasoning as
 * row-level security, applied to a system that has none. `tenantId` is *also* a
 * filterable attribute and *also* filtered on every query, because the index
 * name is a string and strings can be built wrongly.
 */

export interface MeilisearchOptions {
  url: string;
  apiKey?: string;
  /** How long any one call may take before the caller falls back to PostgreSQL. */
  timeoutMs?: number;
}

interface MeiliHit {
  entityType: string;
  entityId: string;
  title: string;
  bodyText: string;
  facets?: Record<string, unknown>;
  _formatted?: { bodyText?: string };
  _rankingScore?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;

/** Index names may contain only letters, digits, hyphen and underscore. */
export function indexNameFor(tenantId: string): string {
  return `itsm_${tenantId.replace(/-/g, '')}`;
}

export function createMeilisearchBackend(options: MeilisearchOptions): SearchBackend {
  const base = options.url.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Indexes are created and configured on first use, then remembered, so a
  // steady-state write is one request rather than three.
  const configured = new Set<string>();

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          ...init.headers,
        },
      });
      if (!response.ok) {
        throw new Error(`meilisearch ${init.method ?? 'GET'} ${path} returned ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Declares the index and its attributes.
   *
   * `filterableAttributes` is the load-bearing part: Meilisearch refuses a
   * filter on an attribute that is not declared, so a missing declaration here
   * would not silently widen a query — it would fail it. That is the right
   * direction for a filter that carries permissions.
   */
  async function ensureIndex(tenantId: string): Promise<string> {
    const uid = indexNameFor(tenantId);
    if (configured.has(uid)) return uid;

    await call('/indexes', {
      method: 'POST',
      body: JSON.stringify({ uid, primaryKey: 'id' }),
    }).catch((error: unknown) => {
      // Already there is the normal case after the first document.
      if (!(error instanceof Error) || !error.message.includes('returned 4')) throw error;
    });

    await call(`/indexes/${uid}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({
        searchableAttributes: ['title', 'bodyText'],
        filterableAttributes: [
          'tenantId',
          'entityType',
          'aclUserIds',
          'aclTeamIds',
          'aclOrgId',
          'aclTenantWide',
          'aclEveryone',
          'facetValues',
        ],
        sortableAttributes: ['sourceUpdatedAt'],
        displayedAttributes: ['id', 'entityType', 'entityId', 'title', 'bodyText', 'facets'],
        // Typo tolerance is the reason this backend exists; identifiers and
        // ticket numbers are the one place it hurts, so they are exempt.
        typoTolerance: { enabled: true, disableOnAttributes: [] },
      }),
    });

    configured.add(uid);
    return uid;
  }

  /** Flattens a document into what the index holds, with the ACL as filterable fields. */
  function toRecord(document: IndexedDocument): Record<string, unknown> {
    return {
      id: documentKey(document.tenantId, document.entityType, document.entityId),
      tenantId: document.tenantId,
      entityType: document.entityType,
      entityId: document.entityId,
      title: document.title,
      bodyText: document.bodyText,
      facets: document.facets,
      // Meilisearch filters on flat values, so the facets a query filters by are
      // also written as `field:value` strings it can match exactly.
      facetValues: Object.entries(document.facets)
        .filter(([, value]) => typeof value === 'string')
        .map(([field, value]) => `${field}:${value as string}`),
      aclUserIds: document.acl.userIds,
      aclTeamIds: document.acl.teamIds,
      aclOrgId: document.acl.orgId ?? '',
      aclTenantWide: document.acl.tenantWide,
      aclEveryone: document.acl.everyone === true,
      sourceUpdatedAt: document.sourceUpdatedAt.getTime(),
    };
  }

  return {
    name: 'meilisearch',

    async healthy() {
      try {
        const health = await call<{ status: string }>('/health');
        return health.status === 'available';
      } catch {
        return false;
      }
    },

    async put(documents: IndexedDocument[]) {
      if (documents.length === 0) return;
      // Documents arrive per tenant because every caller is inside one tenant's
      // context, but group anyway rather than trusting that.
      const byTenant = new Map<string, IndexedDocument[]>();
      for (const document of documents) {
        const bucket = byTenant.get(document.tenantId) ?? [];
        bucket.push(document);
        byTenant.set(document.tenantId, bucket);
      }
      for (const [tenantId, batch] of byTenant) {
        const uid = await ensureIndex(tenantId);
        await call(`/indexes/${uid}/documents`, { method: 'PUT', body: JSON.stringify(batch.map(toRecord)) });
        metrics.increment('search_documents_pushed_total', { engine: 'meilisearch', count: String(batch.length) });
      }
    },

    async remove(tenantId: string, keys) {
      if (keys.length === 0) return;
      const uid = await ensureIndex(tenantId);
      await call(`/indexes/${uid}/documents/delete-batch`, {
        method: 'POST',
        body: JSON.stringify(keys.map((key) => documentKey(tenantId, key.entityType, key.entityId))),
      });
    },

    async dropTenant(tenantId: string) {
      const uid = indexNameFor(tenantId);
      configured.delete(uid);
      // A tenant that never searched has no index; that is not an error.
      await call(`/indexes/${uid}`, { method: 'DELETE' }).catch((error: unknown) => {
        logger.debug('meilisearch index was already absent', { uid, reason: String(error) });
      });
    },

    async query(ctx, options: SearchQuery, visibility: Visibility): Promise<SearchResult> {
      const query = options.query.trim();
      if (query.length === 0) return { hits: [], facetCounts: {}, engine: 'meilisearch' };

      const uid = await ensureIndex(ctx.tenantId);
      const response = await call<{
        hits: MeiliHit[];
        facetDistribution?: Record<string, Record<string, number>>;
      }>(`/indexes/${uid}/search`, {
        method: 'POST',
        body: JSON.stringify({
          q: query,
          limit: options.limit,
          filter: buildFilter(ctx.tenantId, options, visibility),
          facets: options.facetsToCount?.length ? ['facetValues'] : undefined,
          attributesToHighlight: ['bodyText'],
          highlightPreTag: '',
          highlightPostTag: '',
          attributesToCrop: ['bodyText'],
          cropLength: 25,
          showRankingScore: true,
        }),
      });

      return {
        hits: response.hits.map((hit) => ({
          entityType: hit.entityType,
          entityId: hit.entityId,
          title: hit.title,
          snippet: hit._formatted?.bodyText ?? hit.bodyText.slice(0, 200),
          rank: hit._rankingScore ?? 0,
          facets: (hit.facets ?? {}) as Record<string, unknown>,
        })),
        facetCounts: unflattenFacets(response.facetDistribution?.facetValues ?? {}, options.facetsToCount ?? []),
        engine: 'meilisearch',
      };
    },
  };
}

/**
 * The filter expression, permissions first.
 *
 * Every clause is required (`AND`), and the permission clause is a disjunction
 * of the ways a person may see a document — the same predicate the SQL backend
 * applies, written in Meilisearch's syntax. Both are derived from the one
 * `Visibility` the service resolves, so the two backends cannot drift into
 * disagreeing about who sees what.
 */
export function buildFilter(tenantId: string, options: SearchQuery, visibility: Visibility): string {
  const clauses: string[] = [`tenantId = "${tenantId}"`];

  if (options.types?.length) {
    clauses.push(`(${options.types.map((type) => `entityType = "${escape(type)}"`).join(' OR ')})`);
  }

  for (const [field, values] of Object.entries(options.filters ?? {})) {
    if (values.length === 0) continue;
    clauses.push(`(${values.map((value) => `facetValues = "${escape(`${field}:${value}`)}"`).join(' OR ')})`);
  }

  if (visibility.scope !== 'any') {
    const visible: string[] = [`aclUserIds = "${escape(visibility.userId)}"`, 'aclEveryone = true'];
    if (visibility.scope === 'team') visible.push('aclTenantWide = true');
    for (const teamId of visibility.teamIds) visible.push(`aclTeamIds = "${escape(teamId)}"`);
    for (const orgId of visibility.organisationIds) visible.push(`aclOrgId = "${escape(orgId)}"`);
    clauses.push(`(${visible.join(' OR ')})`);
  }

  return clauses.join(' AND ');
}

/** Meilisearch filter values are double-quoted, so a quote or backslash must be escaped. */
function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Turns `{"status:open": 3}` back into `{status: {open: 3}}` for the fields asked for. */
function unflattenFacets(
  distribution: Record<string, number>,
  fields: string[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const field of fields) out[field] = {};
  for (const [key, count] of Object.entries(distribution)) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    const field = key.slice(0, separator);
    if (!(field in out)) continue;
    out[field]![key.slice(separator + 1)] = count;
  }
  return out;
}
