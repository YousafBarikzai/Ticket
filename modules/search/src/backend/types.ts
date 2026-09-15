import type { TenantContext } from '@itsm/platform';

/**
 * The seam between what search *means* and where it runs (ADR-0017).
 *
 * PH-1 and PH-2 served search from a PostgreSQL projection. PH-3 adds
 * Meilisearch for typo tolerance and facets. Only this interface's
 * implementations differ: the projection table, the ACL shape, the indexer and
 * every caller stay exactly as they were, which is what made the swap a
 * contained change rather than a rewrite.
 */

export interface DocumentAcl {
  /** Users who can always see this document: requester, assignee, watchers. */
  userIds: string[];
  /** Teams whose members can see it. */
  teamIds: string[];
  /** Organisation the record belongs to. */
  orgId: string | null;
  /** When true, anyone with tenant-wide read may see it. */
  tenantWide: boolean;
}

/** One document as the backend holds it, independent of how it is stored. */
export interface IndexedDocument {
  tenantId: string;
  entityType: string;
  entityId: string;
  title: string;
  bodyText: string;
  orgId: string | null;
  acl: DocumentAcl;
  facets: Record<string, unknown>;
  sourceUpdatedAt: Date;
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
  facets: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  types?: string[];
  limit: number;
  /** Facet equality filters, e.g. `{ status: ['open', 'in_progress'] }`. */
  filters?: Record<string, string[]>;
  /** Facet fields to count for the result set, for the filter sidebar. */
  facetsToCount?: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** Counts per facet value across everything the caller may see, not just this page. */
  facetCounts: Record<string, Record<string, number>>;
  /** Which backend actually answered. Reported so a degraded answer is visible. */
  engine: 'postgres' | 'meilisearch';
}

/**
 * What the caller is allowed to see, resolved once by the service so that both
 * backends filter on identical inputs rather than each deriving them.
 */
export interface Visibility {
  scope: 'own' | 'team' | 'any';
  userId: string;
  teamIds: string[];
  organisationIds: string[];
}

export interface SearchBackend {
  readonly name: 'postgres' | 'meilisearch';
  /** Whether this backend can answer right now. Never throws. */
  healthy(): Promise<boolean>;
  query(ctx: TenantContext, query: SearchQuery, visibility: Visibility): Promise<SearchResult>;
  /** Upserts documents. The projection table is written separately and remains the source of truth. */
  put(documents: IndexedDocument[]): Promise<void>;
  remove(tenantId: string, keys: { entityType: string; entityId: string }[]): Promise<void>;
  /** Removes everything belonging to one tenant, for `purgeTenant`. */
  dropTenant(tenantId: string): Promise<void>;
}

/** The id a document has in an external engine: stable, and scoped to its tenant. */
export function documentKey(tenantId: string, entityType: string, entityId: string): string {
  return `${tenantId}_${entityType}_${entityId}`.replace(/-/g, '');
}
