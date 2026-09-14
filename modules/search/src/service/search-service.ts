import {
  type TenantContext,
  type Tx,
  authz,
  metrics,
  newId,
  publish,
  transaction,
} from '@itsm/platform';
import { events } from '@itsm/contracts';

/**
 * MOD-09 search (PH-1 slice).
 *
 * A projection rebuilt from events (ADR-0003): it can be dropped and replayed.
 * The visibility predicate is stored on the document and applied BEFORE
 * ranking, so results are permission-filtered at retrieval rather than filtered
 * afterwards — which is what keeps a result count from leaking what a user
 * cannot see.
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

export interface IndexInput {
  entityType: string;
  entityId: string;
  title: string;
  bodyText: string;
  orgId: string | null;
  acl: DocumentAcl;
  facets: Record<string, string | null>;
  sourceUpdatedAt: Date;
}

export async function indexDocument(tx: Tx, ctx: TenantContext, input: IndexInput): Promise<void> {
  const existing = await tx.searchDocument.findFirst({
    where: { entityType: input.entityType, entityId: input.entityId },
  });

  const data = {
    tenantId: ctx.tenantId,
    orgId: input.orgId,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title.slice(0, 1000),
    bodyText: input.bodyText.slice(0, 50_000),
    acl: input.acl as never,
    facets: input.facets as never,
    sourceUpdatedAt: input.sourceUpdatedAt,
  };

  if (existing) {
    await tx.searchDocument.update({ where: { id: existing.id }, data });
  } else {
    await tx.searchDocument.create({ data: { id: newId(), ...data } });
  }

  const lagMs = Math.max(0, Date.now() - input.sourceUpdatedAt.getTime());
  metrics.observe('search_index_lag_ms', lagMs, { entity: input.entityType });
  await publish(tx, ctx, {
    definition: events.searchDocumentIndexed,
    aggregateId: input.entityId,
    payload: { entityType: input.entityType, entityId: input.entityId, lagMs },
  });
}

export async function removeDocument(tx: Tx, entityType: string, entityId: string): Promise<void> {
  await tx.searchDocument.deleteMany({ where: { entityType, entityId } });
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
  facets: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  types?: string[];
  limit: number;
}

/**
 * Permission-filtered full-text search.
 *
 * The SQL applies the visibility predicate in the same statement as the match,
 * so ranking, counting and paging all operate on the set the caller may see.
 */
export async function search(ctx: TenantContext, options: SearchOptions): Promise<SearchHit[]> {
  authz.require(ctx, 'search.query');
  const scope = authz.effectiveScope(ctx, 'search.query');
  const query = options.query.trim();
  if (query.length === 0) return [];

  return transaction(ctx, async (tx) => {
    const types = options.types?.length ? options.types : null;
    const userId = ctx.actor.id ?? '00000000-0000-0000-0000-000000000000';

    const rows = await tx.$queryRaw<{ entity_type: string; entity_id: string; title: string; snippet: string; rank: number; facets: unknown }[]>`
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
        AND (
          ${scope === 'any'}
          OR (acl->>'tenantWide')::boolean = true AND ${scope === 'team'}
          OR acl->'userIds' ? ${userId}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(acl->'teamIds') AS t(team)
            WHERE t.team = ANY(${ctx.teamIds}::text[])
          )
          OR (acl->>'orgId') = ANY(${ctx.organisationIds}::text[])
        )
      ORDER BY rank DESC, source_updated_at DESC
      LIMIT ${options.limit}
    `;

    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: row.title,
      snippet: row.snippet,
      rank: Number(row.rank),
      facets: (row.facets ?? {}) as Record<string, unknown>,
    }));
  });
}

/** Builds the visibility predicate for a ticket. */
export function aclForTicket(ticket: {
  requesterId: string | null;
  affectedUserId: string | null;
  assigneeId: string | null;
  groupId: string | null;
  orgId: string | null;
}, watcherIds: string[]): DocumentAcl {
  return {
    userIds: [...new Set([ticket.requesterId, ticket.affectedUserId, ticket.assigneeId, ...watcherIds].filter((id): id is string => Boolean(id)))],
    teamIds: ticket.groupId ? [ticket.groupId] : [],
    orgId: ticket.orgId,
    tenantWide: true,
  };
}
