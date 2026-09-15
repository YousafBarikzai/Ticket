import type { Actor, EventEnvelope } from '@itsm/contracts';
import {
  type TenantContext,
  claimEvent,
  consumersFor,
  createContext,
  enqueue,
  handlersFor,
  logger,
  metrics,
  platformDb,
  registeredHandlers,
  SYSTEM_PERMISSIONS,
  systemContext,
  transaction,
  withContext,
  cache,
} from '@itsm/platform';

/**
 * The outbox publisher (ADR-0002).
 *
 * One leader moves events from PostgreSQL to the queue; followers idle. Batches
 * are claimed with SKIP LOCKED so a second publisher, or a restart mid-batch,
 * cannot double-publish or stall the queue.
 */

const LEADER_LOCK_KEY = 'platform:outbox-publisher:leader';
const LEADER_TTL_SECONDS = 30;
const BATCH_SIZE = 500;

export async function acquireLeadership(instanceId: string): Promise<boolean> {
  try {
    const redis = cache();
    const held = await redis.get(LEADER_LOCK_KEY);
    if (held && held !== instanceId) return false;
    // A short lease renewed each tick: a crashed leader is replaced within
    // its time-to-live rather than blocking publication indefinitely.
    const result = await redis.set(LEADER_LOCK_KEY, instanceId, 'EX', LEADER_TTL_SECONDS);
    return result === 'OK';
  } catch (error) {
    logger.warn('could not reach Redis for leader election', { error: (error as Error).message });
    return false;
  }
}

export async function releaseLeadership(instanceId: string): Promise<void> {
  try {
    const redis = cache();
    const held = await redis.get(LEADER_LOCK_KEY);
    if (held === instanceId) await redis.del(LEADER_LOCK_KEY);
  } catch {
    // The lease expires on its own; nothing to do.
  }
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  envelope: EventEnvelope;
  created_at: Date;
}

/**
 * Tenants that might have work waiting. The publisher is a cross-tenant
 * component, but row-level security is per tenant and deliberately admits no
 * exception, so it works tenant by tenant rather than reading the whole table.
 */
async function tenantsWithPendingEvents(): Promise<{ id: string; region: string }[]> {
  return platformDb().tenant.findMany({
    where: { status: { in: ['active', 'provisioning'] }, deletedAt: null },
    select: { id: true, region: true },
  });
}

/**
 * Publishes one batch for one tenant. Returns how many events were dispatched,
 * so the caller can keep going while there is a backlog.
 */
export async function publishBatchForTenant(tenantId: string, region = 'eu-west', limit = BATCH_SIZE): Promise<number> {
  const scanContext = systemContext(tenantId, { region });

  return withContext(scanContext, async () =>
    transaction(scanContext, async (tx) => {
      // SKIP LOCKED means a second publisher, or a restart mid-batch, can
      // neither double-publish nor block behind this one.
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, tenant_id, type, envelope, created_at
        FROM outbox_event
        WHERE published_at IS NULL
        ORDER BY aggregate_type, aggregate_id, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return 0;

      let dispatched = 0;
      for (const row of rows) {
        const envelope = row.envelope;
        const consumers = consumersFor(row.type);
        const ctx = contextFromEnvelope(envelope);

        await withContext(ctx, async () => {
          for (const consumer of consumers) {
            // The job id deduplicates at the queue as well as at the inbox, so
            // a retried batch costs nothing.
            await enqueue(ctx, 'events', 'event.dispatch', { consumer, envelope }, { idempotencyKey: jobKey('dispatch', consumer, envelope.id) });
          }
          await enqueue(ctx, 'webhooks', 'webhook.fanout', { envelope }, { idempotencyKey: jobKey('fanout', envelope.id) });
        });

        await tx.$executeRaw`UPDATE outbox_event SET published_at = now() WHERE id = ${row.id}::uuid`;
        dispatched += 1;
      }

      // Lag is the signal that matters most here (objective: p95 under 5 s).
      const oldest = rows[0]?.created_at;
      if (oldest) metrics.observe('outbox_lag_ms', Date.now() - oldest.getTime());
      metrics.increment('outbox_dispatched_total', {}, dispatched);

      return dispatched;
    }),
  );
}

/** Publishes a batch for every tenant that has one waiting. */
export async function publishBatch(limit = BATCH_SIZE): Promise<number> {
  const tenants = await tenantsWithPendingEvents();
  let total = 0;
  for (const tenant of tenants) {
    total += await publishBatchForTenant(tenant.id, tenant.region, limit);
  }
  return total;
}

/**
 * BullMQ rejects a job id containing a colon, so keys are built here rather
 * than spelled out at each call site.
 */
export function jobKey(...parts: string[]): string {
  return parts.join('-');
}

export function contextFromEnvelope(envelope: EventEnvelope): TenantContext {
  return createContext({
    tenantId: envelope.tenantId,
    actor: envelope.actor as Actor,
    permissions: SYSTEM_PERMISSIONS,
    correlationId: envelope.correlationId,
    causationId: envelope.id,
  });
}

/** Runs one consumer against one event, inside the inbox claim. */
export async function dispatchToConsumer(consumer: string, envelope: EventEnvelope): Promise<'done' | 'duplicate'> {
  const ctx = contextFromEnvelope(envelope);
  const handlers = handlersFor(envelope.type).filter((h) => h.consumer === consumer);
  if (handlers.length === 0) {
    logger.debug('no handler for event', { consumer, type: envelope.type });
    return 'done';
  }

  return withContext(ctx, async () =>
    transaction(ctx, async (tx) => {
      const claimed = await claimEvent(tx, consumer, envelope);
      if (!claimed) return 'duplicate' as const;
      for (const handler of handlers) {
        await handler.handle(ctx, envelope, tx);
      }
      return 'done' as const;
    }),
  );
}

/**
 * Finds events that were published but never acknowledged by a required
 * consumer and re-enqueues them. This is what makes Redis loss survivable:
 * the outbox, not the queue, is the durable record.
 */
export async function reconcileUnacknowledged(olderThanMs = 120_000, limit = 200): Promise<number> {
  const required = registeredHandlers().filter((h) => h.required);
  if (required.length === 0) return 0;

  const cutoff = new Date(Date.now() - olderThanMs);
  const tenants = await tenantsWithPendingEvents();
  let requeued = 0;

  for (const tenant of tenants) {
    const scanContext = systemContext(tenant.id, { region: tenant.region });
    requeued += await withContext(scanContext, async () =>
      transaction(scanContext, async (tx) => {
        let tenantRequeued = 0;
        for (const handler of required) {
          const rows = await tx.$queryRaw<{ id: string; envelope: EventEnvelope }[]>`
            SELECT o.id, o.envelope
            FROM outbox_event o
            LEFT JOIN inbox_event i ON i.event_id = o.id AND i.consumer = ${handler.consumer}
            WHERE o.published_at IS NOT NULL
              AND o.published_at < ${cutoff}
              AND o.type = ${handler.eventType}
              AND i.event_id IS NULL
            ORDER BY o.created_at
            LIMIT ${limit}
          `;
          for (const row of rows) {
            const ctx = contextFromEnvelope(row.envelope);
            await withContext(ctx, () =>
              enqueue(
                ctx,
                'events',
                'event.dispatch',
                { consumer: handler.consumer, envelope: row.envelope },
                { idempotencyKey: jobKey('retry', handler.consumer, row.envelope.id, String(Date.now())) },
              ),
            );
            tenantRequeued += 1;
          }
        }
        return tenantRequeued;
      }),
    );
  }

  if (requeued > 0) {
    logger.warn('re-enqueued events that no required consumer acknowledged', { requeued });
    metrics.increment('outbox_reconciled_total', {}, requeued);
  }
  return requeued;
}

/** Keeps the consumer registry in the database in step with the code. */
export async function syncConsumerRegistry(): Promise<void> {
  const db = platformDb();
  const byConsumer = new Map<string, { moduleId: string; eventTypes: Set<string>; required: boolean }>();
  for (const handler of registeredHandlers()) {
    const entry = byConsumer.get(handler.consumer) ?? { moduleId: handler.moduleId, eventTypes: new Set(), required: false };
    entry.eventTypes.add(handler.eventType);
    entry.required = entry.required || handler.required;
    byConsumer.set(handler.consumer, entry);
  }
  for (const [consumer, entry] of byConsumer) {
    await db.consumerRegistry.upsert({
      where: { consumer },
      create: { consumer, moduleId: entry.moduleId, eventTypes: [...entry.eventTypes], required: entry.required },
      update: { moduleId: entry.moduleId, eventTypes: [...entry.eventTypes], required: entry.required },
    });
  }
}
