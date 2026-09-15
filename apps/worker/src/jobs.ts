import {
  ALL_QUEUES,
  defineJob,
  enqueue,
  logger,
  metrics,
  modules,
  newCorrelationId,
  platformDb,
  registeredJobs,
  schedule,
  systemContext,
  withContext,
  type QueueName,
} from '@itsm/platform';
import { outboxPublisher, webhookService } from '@itsm/module-integrations';
import { notificationService } from '@itsm/module-notifications';
import { auditService } from '@itsm/module-security';
import { tickPartition, TIMER_PARTITIONS } from '@itsm/module-sla';
import { checkTicketDrift, rebuildRecent, reportService } from '@itsm/module-analytics';
import { invitationService } from '@itsm/module-feedback';
import { budgetService } from '@itsm/module-time';
import { incidentService as statusIncidentService } from '@itsm/module-statuspage';
import { sweepFiles } from '@itsm/module-migration';
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
        await enqueue(ctx, 'sla', 'sla.tick.partition', { partition }, { idempotencyKey: `tick-${tenant.id}-${partition}-${Math.floor(Date.now() / 60_000)}` });
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

// ---------------------------------------------------------------------------
// Reporting (MOD-12)
//
// Both fan out over tenants here rather than inside the module, so one tenant's
// year of history cannot hold up everybody else's nightly rebuild.
// ---------------------------------------------------------------------------

defineJob('analytics', 'analytics.rollup.rebuild', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const result = await rebuildRecent(ctx);
      logger.debug('rollup rebuilt', { tenantId: tenant.id, ...result });
    });
  }
});

defineJob('analytics', 'analytics.report.sweep', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const ran = await reportService.runDue(ctx);
      if (ran > 0) logger.info('scheduled reports ran', { tenantId: tenant.id, ran });
    });
  }
});

defineJob('retention', 'feedback.expiry.sweep', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const expired = await invitationService.expireDue(ctx);
      if (expired > 0) logger.debug('survey invitations expired', { tenantId: tenant.id, expired });
    });
  }
});

defineJob('analytics', 'budget.sweep', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const result = await budgetService.recomputeAll(ctx);
      if (result.corrected > 0) logger.info('budget totals corrected', { tenantId: tenant.id, ...result });
    });
  }
});

defineJob('retention', 'import.file.sweep', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const removed = await sweepFiles(ctx);
      if (removed > 0) logger.debug('import files swept', { tenantId: tenant.id, removed });
    });
  }
});

defineJob('notify', 'status.maintenance.sweep', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const moved = await statusIncidentService.sweepMaintenance(ctx);
      if (moved > 0) logger.debug('maintenance windows moved', { tenantId: tenant.id, moved });
    });
  }
});

defineJob('analytics', 'analytics.drift.check', async () => {
  for (const tenant of await activeTenants()) {
    const ctx = systemContext(tenant.id, { region: tenant.region, correlationId: newCorrelationId() });
    await withContext(ctx, async () => {
      const result = await checkTicketDrift(ctx);
      if (result.breached) {
        logger.warn('analytics projection has drifted', {
          tenantId: tenant.id,
          expected: result.expected,
          actual: result.actual,
        });
      }
    });
  }
});

/** Registers the repeatable schedules. Idempotent: BullMQ keys them by job id. */
export async function registerSchedules(queues: QueueName[]): Promise<void> {
  // Read from the manifests rather than listed here. The list had already
  // drifted: MOD-04 declares `ticket.autoClose` hourly and nothing scheduled
  // it, which is the failure mode a second copy of a declaration always has —
  // the module says the job runs nightly, the deployment quietly disagrees, and
  // nobody looks until a report is missing.
  const wanted = modules()
    .flatMap((module) => module.jobs.map((job) => ({ ...job, moduleId: module.id })))
    .filter((job): job is typeof job & { schedule: string } => Boolean(job.schedule));

  const handled = new Set(registeredJobs());

  for (const entry of wanted) {
    if (!queues.includes(entry.queue)) continue;
    // A declared job with no handler would be enqueued every tick and dropped
    // with a warning. Skipping it says so once, at boot, where it is visible.
    if (!handled.has(`${entry.queue}:${entry.name}`)) {
      logger.warn('declared job has no handler; not scheduling', { module: entry.moduleId, job: entry.name });
      continue;
    }
    await schedule(entry.queue, entry.name, entry.schedule);
    logger.info('schedule registered', { queue: entry.queue, job: entry.name, pattern: entry.schedule });
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
