import {
  ALL_QUEUES,
  defineJob,
  enqueue,
  logger,
  metrics,
  newCorrelationId,
  platformDb,
  schedule,
  systemContext,
  withContext,
  type QueueName,
} from '@itsm/platform';
import { outboxPublisher, webhookService } from '@itsm/module-integrations';
import { notificationService } from '@itsm/module-notifications';
import { auditService } from '@itsm/module-security';
import { tickPartition, TIMER_PARTITIONS } from '@itsm/module-sla';
import type { EventEnvelope } from '@itsm/contracts';

/**
 * The worker's job definitions (docs/architecture/03 §4).
 *
 * Scheduled jobs fan out one child job per active tenant, so one tenant's
 * backlog cannot delay another's — the pattern every recurring job follows.
 */

const PUBLISHER_INSTANCE = `${process.env.HOSTNAME ?? 'worker'}-${process.pid}`;

/** Tenants that are able to do work right now. */
async function activeTenants(): Promise<{ id: string; region: string }[]> {
  const tenants = await platformDb().tenant.findMany({
    where: { status: 'active', deletedAt: null },
    select: { id: true, region: true },
  });
  return tenants;
}

// ---------------------------------------------------------------------------
// Eventing
// ---------------------------------------------------------------------------

defineJob('outbox', 'outbox.publish', async () => {
  // Only the leader publishes; the rest of the replicas hold the lease warm so
  // a crash is covered within its time-to-live.
  const leader = await outboxPublisher.acquireLeadership(PUBLISHER_INSTANCE);
  if (!leader) return;

  let total = 0;
  // Keep going while there is a backlog: publisher lag is the SLI that matters.
  for (let pass = 0; pass < 20; pass += 1) {
    const dispatched = await outboxPublisher.publishBatch();
    total += dispatched;
    if (dispatched === 0) break;
  }
  if (total > 0) logger.debug('outbox batch published', { dispatched: total });
});

defineJob<{ consumer: string; envelope: EventEnvelope }>('events', 'event.dispatch', async (payload) => {
  const outcome = await outboxPublisher.dispatchToConsumer(payload.consumer, payload.envelope);
  metrics.increment('events_dispatched_total', { consumer: payload.consumer, outcome });
});

defineJob('reconcile', 'outbox.reconcile', async () => {
  const requeued = await outboxPublisher.reconcileUnacknowledged();
  if (requeued > 0) logger.warn('reconciler re-enqueued unacknowledged events', { requeued });
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

defineJob<{ envelope: EventEnvelope }>('webhooks', 'webhook.fanout', async (payload, { ctx }) => {
  await webhookService.fanOut(ctx, payload.envelope);
});

defineJob<{ deliveryId: string }>('webhooks', 'webhook.deliver', async (payload, { ctx }) => {
  await webhookService.deliverWebhook(ctx, payload.deliveryId);
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

defineJob<{ notificationId: string; channel: string }>('notify', 'notification.dispatch', async (payload, { ctx }) => {
  await notificationService.dispatch(ctx, payload.notificationId, payload.channel);
});

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

defineJob('sla', 'sla.tick', async () => {
  const tenants = await activeTenants();
  for (const tenant of tenants) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      for (let partition = 0; partition < TIMER_PARTITIONS; partition += 1) {
        await enqueue(ctx, 'sla', 'sla.tick.partition', { partition }, { idempotencyKey: `tick:${tenant.id}:${partition}:${Math.floor(Date.now() / 60_000)}` });
      }
    });
  }
});

defineJob<{ partition: number }>('sla', 'sla.tick.partition', async (payload, { ctx }) => {
  const result = await tickPartition(ctx, payload.partition);
  if (result.warnings > 0 || result.breaches > 0) {
    logger.info('sla timers fired', {
      partition: payload.partition,
      warnings: result.warnings,
      breaches: result.breaches,
      maxLatenessMs: result.maxLatenessMs,
    });
  }
});

// ---------------------------------------------------------------------------
// Security and retention
// ---------------------------------------------------------------------------

defineJob('retention', 'audit.verifyChain', async () => {
  const tenants = await activeTenants();
  for (const tenant of tenants) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const result = await auditService.verifyTenantChain(ctx);
      if (!result.valid) {
        logger.error('audit chain is broken', { tenantId: tenant.id, checked: result.checked });
      }
    });
  }
});

/** Registers the repeatable schedules. Idempotent: BullMQ keys them by job id. */
export async function registerSchedules(queues: QueueName[]): Promise<void> {
  const wanted: { queue: QueueName; job: string; pattern: string }[] = [
    { queue: 'outbox', job: 'outbox.publish', pattern: '* * * * *' },
    { queue: 'reconcile', job: 'outbox.reconcile', pattern: '* * * * *' },
    { queue: 'sla', job: 'sla.tick', pattern: '* * * * *' },
    { queue: 'retention', job: 'audit.verifyChain', pattern: '0 2 * * *' },
  ];

  for (const entry of wanted) {
    if (!queues.includes(entry.queue)) continue;
    await schedule(entry.queue, entry.job, entry.pattern);
    logger.info('schedule registered', { queue: entry.queue, job: entry.job, pattern: entry.pattern });
  }
}

/**
 * The outbox publisher is polled by a schedule, but a minute is far too long to
 * wait for an event that a user is watching for. A short in-process tick keeps
 * lag inside its five-second objective without a busy loop.
 */
export function startPublisherTicker(queues: QueueName[], intervalMs = 1000): NodeJS.Timeout | null {
  if (!queues.includes('outbox')) return null;
  const ctx = systemContext('00000000-0000-0000-0000-000000000000');
  return setInterval(() => {
    void withContext(ctx, async () => {
      try {
        const leader = await outboxPublisher.acquireLeadership(PUBLISHER_INSTANCE);
        if (leader) await outboxPublisher.publishBatch(200);
      } catch (error) {
        logger.debug('publisher tick failed', { error: (error as Error).message });
      }
    });
  }, intervalMs);
}

export { ALL_QUEUES };
