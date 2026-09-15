import type { EventEnvelope } from '@itsm/contracts';
import { authz, handlersFor, logger, metrics, transaction, type TenantContext } from '@itsm/platform';
import { analyticsManifest } from '../manifest.js';
import { rebuildRange } from './rebuild-service.js';

/**
 * Replaying the projection from the outbox.
 *
 * The outbox is the durable record (ADR-0002), so a projection can always be
 * rebuilt from it: hand every event this module consumes back to this module's
 * handlers, in order, as if it were arriving for the first time. The inbox is
 * bypassed on purpose — these events were already claimed once — which is safe
 * only because every projector reads the source rows rather than accumulating
 * from the payload. A replayed `ticket.comment.added` re-reads the comment
 * count; it does not add one.
 *
 * `from` bounds the work, not the correctness: an event from before the bound
 * whose ticket was touched afterwards is refreshed by the later event, because
 * a refresh rebuilds the whole fact from the row.
 */

const BATCH = 200;

export async function replayProjection(
  ctx: TenantContext,
  options: { from?: Date; to?: Date } = {},
): Promise<{ replayed: number; skipped: number; from: Date | null }> {
  authz.require(ctx, 'analytics.admin');
  const types = analyticsManifest.events.consumes;
  const handlers = new Map(types.map((type) => [type, handlersFor(type).filter((handler) => handler.consumer === 'analytics')]));

  let replayed = 0;
  let skipped = 0;
  let cursor: { createdAt: Date; id: string } | undefined;

  for (;;) {
    const batch = await transaction(ctx, async (tx) => {
      const rows = await tx.outboxEvent.findMany({
        where: {
          type: { in: [...types] },
          ...(options.from ? { createdAt: { gte: options.from, ...(options.to ? { lte: options.to } : {}) } } : options.to ? { createdAt: { lte: options.to } } : {}),
          ...(cursor
            ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
      });

      for (const row of rows) {
        const envelope = row.envelope as unknown as EventEnvelope;
        const matching = handlers.get(row.type) ?? [];
        if (matching.length === 0) {
          skipped += 1;
          continue;
        }
        for (const handler of matching) await handler.handle(ctx, envelope, tx);
        replayed += 1;
      }
      return rows;
    });

    const last = batch.at(-1);
    if (!last || batch.length < BATCH) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  // The rollup follows the facts, so a replay that corrected anything is
  // followed by a rebuild of the days it could have touched.
  if (replayed > 0) {
    await rebuildRange(ctx, options.from ?? new Date(Date.UTC(2020, 0, 1)), options.to ?? new Date());
  }

  metrics.increment('analytics_replayed_events_total', {}, replayed);
  logger.info('projection replayed', { tenantId: ctx.tenantId, replayed, skipped, from: options.from?.toISOString() ?? null });
  return { replayed, skipped, from: options.from ?? null };
}
