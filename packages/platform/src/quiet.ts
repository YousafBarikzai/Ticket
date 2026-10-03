import { logger, metrics } from './telemetry.js';

/**
 * Quiet tenants (SPEC v3 §5.2 Q2, A4 §2.4).
 *
 * The shared demo is rebuilt every night into a brand-new tenant, and the
 * build writes four months of history through the same services a live
 * tenant uses. Those services were written for live work, so some of them
 * reach for the queue directly — a status-page notice, a survey posted to
 * chat, a workflow step — and a history import must set off none of them: an
 * e-mail sent from a rebuild is an e-mail sent to nobody, about nothing, from
 * a product a prospect is evaluating.
 *
 * The build marks its tenant quiet before the tenant's first row exists, and
 * `enqueue()` then refuses any job for it. That turns a path nobody knew
 * about into a failed build in CI, rather than a stray job in production. It
 * is one of three independent guarantees, and deliberately the crudest: the
 * tenant's `seeding` status keeps the outbox publisher and the schedulers
 * away (Q1), and the unpublished outbox is discarded before the swap (Q3).
 *
 * Process-local on purpose. The build runs start to finish in one worker
 * process, and nothing outside it can act for a `seeding` tenant: the API
 * refuses demo tokens for any tenant that is not `active` (§4.4), and the
 * publisher and schedulers skip it. A shared set in Redis would add a network
 * round trip to every enqueue on the platform to protect against a process
 * that cannot exist.
 */

const quiet = new Set<string>();
let refusals = 0;

/**
 * A job was refused because its tenant is being built quietly. Not a
 * `DomainError`: it is never the caller's fault in a way a client could act
 * on. It means a service enqueued work during a history import, which is a
 * defect in that service's import path, and it should fail loudly as one.
 */
export class QuietTenantError extends Error {
  readonly code = 'tenant_quiet';

  constructor(
    readonly tenantId: string,
    readonly queueName: string,
    readonly jobName: string,
  ) {
    super(`refused to enqueue ${queueName} ${jobName} for tenant ${tenantId}: it is being built and must stay quiet`);
    this.name = 'QuietTenantError';
  }
}

/**
 * Marks a tenant quiet. Call it before the tenant's first row is written —
 * the build chooses the tenant's id up front for exactly this reason — and
 * pair it with `endQuiet` in a `finally`.
 */
export function beginQuiet(tenantId: string): void {
  quiet.add(tenantId);
}

/** Lifts the mark. Safe to call for a tenant that was never quiet. */
export function endQuiet(tenantId: string): void {
  quiet.delete(tenantId);
}

export function isQuiet(tenantId: string): boolean {
  return quiet.has(tenantId);
}

/**
 * How many jobs this process has refused for a quiet tenant. The build's
 * final check (V9) reads it before and after, so a refusal that some service
 * caught and swallowed still fails the build instead of passing unnoticed.
 */
export function quietRefusals(): number {
  return refusals;
}

/** Throws `QuietTenantError` when `tenantId` is quiet; called by `enqueue()` before the queue is touched. */
export function assertNotQuiet(tenantId: string, queueName: string, jobName: string): void {
  if (!quiet.has(tenantId)) return;
  refusals += 1;
  metrics.increment('jobs_enqueue_refused_total', { reason: 'quiet' });
  logger.error('refused a job for a tenant that is being built quietly', { tenantId, queue: queueName, job: jobName });
  throw new QuietTenantError(tenantId, queueName, jobName);
}
