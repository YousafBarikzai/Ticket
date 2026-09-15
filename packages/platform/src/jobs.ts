import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import type { TenantContext } from './context.js';
import { createContext, withContext } from './context.js';
import { queueConnection } from './redis.js';
import { buildPermissionSet, type PermissionSet } from './authz.js';
import { SYSTEM_PERMISSIONS } from './context.js';
import { logger, metrics } from './telemetry.js';
import { newCorrelationId } from './ids.js';

/**
 * Background work (docs/architecture/05 §5).
 *
 * The queue families match the worker services, so a burst of AI or indexing
 * work can never starve outbox publishing or SLA timers (docs/architecture/03 §4).
 */
export const QUEUE_FAMILIES = {
  events: ['outbox', 'events', 'webhooks', 'reconcile'],
  engine: ['workflow', 'sla', 'rules'],
  comms: ['notify', 'channels'],
  data: ['search', 'scan', 'imports', 'exports', 'analytics', 'retention', 'ai'],
} as const;

export type QueueName =
  | (typeof QUEUE_FAMILIES)[keyof typeof QUEUE_FAMILIES][number];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE_FAMILIES).flat() as QueueName[];

export function queuesForFamilies(spec: string): QueueName[] {
  if (spec === '*') return ALL_QUEUES;
  const wanted = spec.split(',').map((s) => s.trim()).filter(Boolean);
  const out = new Set<QueueName>();
  for (const name of wanted) {
    const family = QUEUE_FAMILIES[name as keyof typeof QUEUE_FAMILIES];
    if (family) family.forEach((q) => out.add(q as QueueName));
    else if ((ALL_QUEUES as string[]).includes(name)) out.add(name as QueueName);
  }
  return [...out];
}

/** The tenant and actor travel with every job so context is never lost. */
export interface JobEnvelope<T = unknown> {
  tenantId: string;
  correlationId: string;
  causationId?: string;
  actorType: string;
  actorId?: string | null;
  payload: T;
}

const queues = new Map<QueueName, Queue>();

export function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: queueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

export interface EnqueueOptions extends JobsOptions {
  /** Deduplicates: two jobs with the same key collapse into one. */
  idempotencyKey?: string;
}

export async function enqueue<T>(
  ctx: TenantContext,
  name: QueueName,
  jobName: string,
  payload: T,
  options: EnqueueOptions = {},
): Promise<string | undefined> {
  const { idempotencyKey, ...jobOptions } = options;
  const envelope: JobEnvelope<T> = {
    tenantId: ctx.tenantId,
    correlationId: ctx.correlationId,
    ...(ctx.causationId ? { causationId: ctx.causationId } : {}),
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    payload,
  };
  const job = await queue(name).add(jobName, envelope, {
    ...jobOptions,
    ...(idempotencyKey ? { jobId: idempotencyKey } : {}),
  });
  metrics.increment('jobs_enqueued_total', { queue: name, job: jobName });
  return job.id;
}

/** Registers a repeatable job. Schedules are declared in module manifests. */
export async function schedule(name: QueueName, jobName: string, pattern: string, payload: unknown = {}): Promise<void> {
  await queue(name).add(
    jobName,
    { tenantId: '00000000-0000-0000-0000-000000000000', correlationId: newCorrelationId(), actorType: 'scheduler', payload },
    // Hyphen, not a colon: BullMQ reserves the colon for its own key structure
    // and refuses a custom id containing one. Version 5 lets it through and
    // version 6 does not, so this was a latent break waiting for an upgrade.
    { repeat: { pattern }, jobId: `repeat-${jobName}` },
  );
}

export interface JobHandlerContext {
  ctx: TenantContext;
  jobName: string;
  attempt: number;
}

export type JobHandler<T = unknown> = (payload: T, meta: JobHandlerContext) => Promise<void>;

const handlers = new Map<string, { queue: QueueName; handler: JobHandler<never>; permissions?: PermissionSet }>();

export function defineJob<T>(queueName: QueueName, jobName: string, handler: JobHandler<T>, permissions?: PermissionSet): void {
  handlers.set(`${queueName}:${jobName}`, { queue: queueName, handler: handler as JobHandler<never>, permissions });
}

export function registeredJobs(): string[] {
  return [...handlers.keys()].sort();
}

export function clearJobs(): void {
  handlers.clear();
}

/** Builds the processor a worker runs: rebuilds context, then dispatches. */
export function processorFor(queueName: QueueName): Processor {
  return async (job) => {
    const registration = handlers.get(`${queueName}:${job.name}`);
    if (!registration) {
      logger.warn('no handler registered for job', { queue: queueName, job: job.name });
      return;
    }
    const envelope = job.data as JobEnvelope;
    const ctx = createContext({
      tenantId: envelope.tenantId,
      actor: { type: (envelope.actorType as never) ?? 'system', id: envelope.actorId ?? null },
      permissions: registration.permissions ?? SYSTEM_PERMISSIONS,
      correlationId: envelope.correlationId,
      ...(envelope.causationId ? { causationId: envelope.causationId } : {}),
    });

    await withContext(ctx, async () => {
      await metrics.time('job_duration_ms', { queue: queueName, job: job.name }, async () => {
        await registration.handler(envelope.payload as never, { ctx, jobName: job.name, attempt: job.attemptsMade + 1 });
      });
    });
  };
}

export function startWorker(queueName: QueueName, concurrency = 8): Worker {
  const worker = new Worker(queueName, processorFor(queueName), {
    connection: queueConnection(),
    concurrency,
  });
  worker.on('failed', (job, error) => {
    logger.error('job failed', {
      queue: queueName,
      job: job?.name,
      jobId: job?.id,
      attempt: job?.attemptsMade,
      error: error.message,
    });
    metrics.increment('jobs_failed_total', { queue: queueName, job: job?.name ?? 'unknown' });
  });
  worker.on('completed', (job) => {
    metrics.increment('jobs_completed_total', { queue: queueName, job: job.name });
  });
  return worker;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
  queues.clear();
}

export { buildPermissionSet };
