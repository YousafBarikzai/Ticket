import { defineJob, logger } from '@itsm/platform';
import { reindexTenant } from '../service/search-service.js';

/**
 * Rebuilds a tenant's external index from the projection.
 *
 * Needed for three ordinary situations rather than only for disasters: turning
 * Meilisearch on for a platform that has been running without it, changing the
 * index settings (attributes are applied to documents at write time, so a
 * settings change needs a rewrite), and recovering from an engine restarted
 * with an empty volume.
 *
 * It reads from the projection rather than replaying the outbox, so it is a
 * bounded copy of current state rather than a replay of history — the outbox
 * replay remains available and rebuilds the projection itself.
 */
defineJob<{ entityType?: string }>('search', 'search.reindex', async (payload, { ctx }) => {
  const pushed = await reindexTenant(ctx, payload.entityType);
  logger.info('search.reindex finished', { tenantId: ctx.tenantId, entityType: payload.entityType ?? 'all', pushed });
});
