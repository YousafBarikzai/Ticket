import {
  type TenantContext,
  type Tx,
  authz,
  logger,
  metrics,
  newId,
  publish,
  transaction,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { backendForQuery, externalBackend, postgresBackend } from '../backend/index.js';
import type { DocumentAcl, IndexedDocument, SearchHit, SearchResult, Visibility } from '../backend/types.js';

/**
 * MOD-09 search.
 *
 * A projection rebuilt from events (ADR-0003): it can be dropped and replayed.
 * The visibility predicate is stored on the document and applied BEFORE
 * ranking, so results are permission-filtered at retrieval rather than filtered
 * afterwards — which is what keeps a result count from leaking what a user
 * cannot see.
 *
 * Phase 3 added Meilisearch behind `SearchBackend` (ADR-0017). This file is
 * unchanged in what it means: it still writes the projection in the caller's
 * transaction and still resolves visibility one way. What it no longer does is
 * decide how a query is executed.
 */

export type { DocumentAcl, SearchHit, SearchResult } from '../backend/types.js';

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

/**
 * Writes one document into the projection.
 *
 * `announce` (on by default) publishes `search.document.indexed`, which is how
 * the external engine hears about it. A bulk rebuild turns it off and pushes
 * the whole projection once with `reindexTenant` instead of queueing an event
 * per document.
 */
export async function indexDocument(tx: Tx, ctx: TenantContext, input: IndexInput, options: { announce?: boolean } = {}): Promise<void> {
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

  // The external engine is updated by a consumer of this event rather than
  // here. An HTTP call cannot join a database transaction, so putting it here
  // would mean either a commit that rolls back after the index was written, or
  // an index write lost when the transaction fails. Going through the outbox
  // makes it exactly-once and retryable, like every other external effect
  // (ADR-0002).
  if (options.announce === false) return;
  await publish(tx, ctx, {
    definition: events.searchDocumentIndexed,
    aggregateId: input.entityId,
    payload: { entityType: input.entityType, entityId: input.entityId, lagMs },
  });
}

/**
 * Indexes one ticket from its row, as it stands: the body of the handler that
 * follows every ticket event (`handlers/index.ts`), here so the handler and a
 * bulk rebuild (`reprojectTickets`) share it (A4 §2.8). Returns whether a
 * document was written; a ticket that has gone, or was deleted, has none.
 */
export async function indexTicket(tx: Tx, ctx: TenantContext, ticketId: string, options: { announce?: boolean } = {}): Promise<boolean> {
  const ticket = await tx.ticket.findFirst({ where: { id: ticketId, deletedAt: null } });
  if (!ticket) return false;

  const watchers = await tx.ticketWatcher.findMany({ where: { ticketId } });
  await indexDocument(
    tx,
    ctx,
    {
      entityType: 'ticket',
      entityId: ticket.id,
      title: `${ticket.number} ${ticket.title}`,
      bodyText: [ticket.title, ticket.description ?? ''].join('\n'),
      orgId: ticket.orgId,
      acl: aclForTicket(ticket, watchers.map((w) => w.userId)),
      facets: {
        type: ticket.type,
        status: ticket.status,
        statusCategory: ticket.statusCategory,
        priority: ticket.priority,
        number: ticket.number,
      },
      sourceUpdatedAt: ticket.updatedAt,
    },
    options,
  );
  return true;
}

/** Tickets per transaction in `reprojectTickets`. */
const REPROJECT_BATCH = 200;

/**
 * Rebuilds the PostgreSQL search projection of every ticket in the tenant,
 * 200 to a transaction (A4 §2.8): for a tenant whose tickets were imported
 * with their events discarded (the demo build), or an index that has to be
 * rebuilt from the records.
 *
 * Writes the projection only and announces nothing; follow it with
 * `reindexTenant(ctx)` to push the projection to the external engine in bulk,
 * as the demo build's last step does. Returns how many tickets were indexed.
 */
export async function reprojectTickets(ctx: TenantContext, options: { batch?: number } = {}): Promise<number> {
  const batch = options.batch ?? REPROJECT_BATCH;
  let indexed = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await transaction(ctx, async (tx) => {
      const rows = await tx.ticket.findMany({
        where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: batch,
      });
      for (const row of rows) {
        if (await indexTicket(tx, ctx, row.id, { announce: false })) indexed += 1;
      }
      return rows;
    });
    if (page.length < batch) break;
    cursor = page.at(-1)!.id;
  }

  metrics.increment('search_tickets_reprojected_total', {}, indexed);
  logger.info('rebuilt the ticket search projection', { tenantId: ctx.tenantId, indexed });
  return indexed;
}

/**
 * Removes a document from search.
 *
 * It publishes the same event an index does, because the consumer already reads
 * the projection and removes from the external engine when the row has gone.
 * Without this, deleting the projection row left the document in Meilisearch
 * indefinitely — so a retired knowledge article stayed findable, which is worse
 * than one that never existed: a reader has no way to know the instructions are
 * withdrawn. The same shape as the Phase 2 tenant-purge defect, one layer out.
 */
export async function removeDocument(
  ctx: TenantContext,
  tx: Tx,
  entityType: string,
  entityId: string,
): Promise<void> {
  await tx.searchDocument.deleteMany({ where: { entityType, entityId } });

  await publish(tx, ctx, {
    definition: events.searchDocumentIndexed,
    aggregateId: entityId,
    payload: { entityType, entityId, lagMs: 0 },
  });
}

export interface SearchOptions {
  query: string;
  types?: string[];
  limit: number;
  filters?: Record<string, string[]>;
  facetsToCount?: string[];
}

/**
 * What this caller may see, resolved once.
 *
 * Both backends filter on this exact object rather than each deriving its own
 * predicate from the context, which is the only way two implementations of a
 * permission filter stay in agreement.
 */
export function visibilityFor(ctx: TenantContext): Visibility {
  return {
    // No scope means the permission grants nothing broader than the person's own
    // records, which is the safe reading of an absent grant.
    scope: authz.effectiveScope(ctx, 'search.query') ?? 'own',
    userId: ctx.actor.id ?? '00000000-0000-0000-0000-000000000000',
    teamIds: ctx.teamIds,
    organisationIds: ctx.organisationIds,
  };
}

/** Permission-filtered search, answered by whichever backend is available. */
export async function searchWithFacets(ctx: TenantContext, options: SearchOptions): Promise<SearchResult> {
  authz.require(ctx, 'search.query');
  const visibility = visibilityFor(ctx);
  const backend = await backendForQuery();

  try {
    const result = await backend.query(ctx, options, visibility);
    metrics.increment('search_queries_total', { engine: result.engine });
    return result;
  } catch (error) {
    if (backend.name === 'postgres') throw error;
    // A search that fails is worse than a search without typo tolerance, and
    // the projection is never stale, so there is always a correct answer to
    // fall back to.
    logger.warn('search engine failed mid-query; answering from the PostgreSQL projection', {
      engine: backend.name,
      reason: error instanceof Error ? error.message : String(error),
    });
    metrics.increment('search_backend_fallback_total', { from: backend.name, to: 'postgres' });
    return postgresBackend.query(ctx, options, visibility);
  }
}

/** The Phase 1 shape, kept because every existing caller and the API use it. */
export async function search(ctx: TenantContext, options: SearchOptions): Promise<SearchHit[]> {
  const result = await searchWithFacets(ctx, options);
  return result.hits;
}

/**
 * Pushes one document from the projection into the external engine.
 *
 * Reading it back out of the projection rather than taking it from the event is
 * deliberate: the projection is the source of truth for what the index should
 * contain, so a replay of old events cannot write a stale document over a newer
 * one.
 */
export async function pushToExternal(ctx: TenantContext, tx: Tx, entityType: string, entityId: string): Promise<void> {
  const backend = externalBackend();
  if (!backend) return;

  const row = await tx.searchDocument.findFirst({ where: { entityType, entityId } });
  if (!row) {
    await backend.remove(ctx.tenantId, [{ entityType, entityId }]);
    return;
  }

  await backend.put([toIndexedDocument(row)]);
}

/** Rebuilds one tenant's external index from the projection, in batches. */
export async function reindexTenant(ctx: TenantContext, entityType?: string): Promise<number> {
  const backend = externalBackend();
  if (!backend) return 0;

  let pushed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await transaction(ctx, (tx) =>
      tx.searchDocument.findMany({
        where: entityType ? { entityType } : {},
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: 500,
      }),
    );
    if (batch.length === 0) break;

    await backend.put(batch.map(toIndexedDocument));
    pushed += batch.length;
    cursor = batch[batch.length - 1]!.id;
  }

  logger.info('rebuilt the external search index', { tenantId: ctx.tenantId, entityType: entityType ?? 'all', pushed });
  return pushed;
}

function toIndexedDocument(row: {
  tenantId: string;
  entityType: string;
  entityId: string;
  title: string;
  bodyText: string;
  orgId: string | null;
  acl: unknown;
  facets: unknown;
  sourceUpdatedAt: Date;
}): IndexedDocument {
  return {
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    bodyText: row.bodyText,
    orgId: row.orgId,
    acl: row.acl as DocumentAcl,
    facets: (row.facets ?? {}) as Record<string, unknown>,
    sourceUpdatedAt: row.sourceUpdatedAt,
  };
}

/** Builds the visibility predicate for a ticket. */
export function aclForTicket(
  ticket: {
    requesterId: string | null;
    affectedUserId: string | null;
    assigneeId: string | null;
    groupId: string | null;
    orgId: string | null;
  },
  watcherIds: string[],
): DocumentAcl {
  return {
    userIds: [
      ...new Set(
        [ticket.requesterId, ticket.affectedUserId, ticket.assigneeId, ...watcherIds].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    ],
    teamIds: ticket.groupId ? [ticket.groupId] : [],
    orgId: ticket.orgId,
    tenantWide: true,
    // Never `everyone`: a ticket is visible to the people working it and the
    // people named on it, not to everybody who can sign in.
    everyone: false,
  };
}
