import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, ValidationError, authz, logger, metrics, newId, transaction } from '@itsm/platform';
import { markBreached, refreshTicketFact } from './ticket-projector.js';
import { refreshTimerFact } from './sla-projector.js';
import { refreshApprovalFact } from './approval-projector.js';
import { refreshTaskFact } from './task-projector.js';
import { refreshSurveyFact } from './survey-projector.js';
import { refreshTimeFact } from './time-projector.js';
import { refreshNotificationFact } from './notification-projector.js';
import { rebuildRange } from './rebuild-service.js';
import { bumpQueryVersion } from './query-cache.js';

/**
 * Reprojecting from the source rows (A4 §2.7, W5).
 *
 * `replayProjection` rebuilds the facts from the outbox, which holds every
 * event a tenant ever published. A tenant whose history was imported has no
 * such record: the demo build discards its events before the tenant goes live
 * (A4 §2.4 Q3), and an imported ticket's SLA clocks were never events at all,
 * only rows `replayTimers` wrote. What it does have is the rows themselves,
 * and every projector here is already a pure function of its source rows — an
 * event only says *look again* (`ticket-projector.ts`). So this walks the
 * rows and asks each projector to look.
 *
 * Each batch is one transaction and one synthetic envelope, `analytics.
 * reprojected`, which is all a projector reads from an event: an id for its
 * cursor and an instant. The incremental rollup diff is skipped, and the
 * window's days are rebuilt from the facts once at the end, which is cheaper
 * and arrives at the same numbers (`rebuild-service.ts`).
 *
 * What the reprojection cannot reproduce is what only an event knew, and only
 * one thing is: a ticket's `breached` flag, set by `sla.timer.breached`. It
 * is read back from the timers instead — a ticket with a timer that has a
 * `breachedAt` breached — which is the same rule, stated on the row.
 */

/** The source tables, in the order they are walked: tickets first, so a breached timer finds its ticket's fact. */
export const REPROJECT_SOURCES = ['tickets', 'timers', 'approvals', 'tasks', 'surveys', 'time', 'notifications'] as const;
export type ReprojectSource = (typeof REPROJECT_SOURCES)[number];

export interface ReprojectOptions {
  /**
   * The window, half-open like every other window (`[from, to)`): a row is
   * reprojected when its own instant falls in it — a ticket's `createdAt`, a
   * timer's `startedAt`, an approval's `requestedAt`, a task's `createdAt`, a
   * survey response's `respondedAt`, a time entry's `loggedAt`, a
   * notification's `createdAt`. The rollup is rebuilt for every day the
   * window touches.
   */
  from: Date;
  to: Date;
  /** Rows per transaction. Default 200. */
  batch?: number;
  /** Which tables; default all of them. */
  sources?: readonly ReprojectSource[];
  /**
   * Batches in flight at once, default 1. The demo build passes
   * `DEMO_BUILD_PARALLELISM` (R3). Batches touch different fact rows but can
   * meet on the shared ones a projector creates on first sight (a team's or
   * a day's dimension row, the projector's cursor); a batch that loses such a
   * race is rolled back whole and run again, which is safe because every
   * projector only ever writes what its rows say.
   */
  parallelism?: number;
}

export interface ReprojectResult {
  tickets: number;
  timers: number;
  approvals: number;
  tasks: number;
  surveys: number;
  time: number;
  notifications: number;
  /** Days of `rollup_ticket_daily` rebuilt; 0 when neither tickets nor timers were reprojected. */
  rollupDays: number;
}

const DEFAULT_BATCH = 200;
const MAX_BATCH = 1_000;
const MAX_PARALLELISM = 8;
/** Ids read per query when listing a source; the batches are cut from these. */
const ID_PAGE = 5_000;
/** A batch that lost a race on a shared row is run again, at most this many times in all. */
const MAX_ATTEMPTS = 4;
/** A batch is two hundred projections of a dozen statements each. */
const BATCH_TIMEOUT_MS = 120_000;

interface Window {
  from: Date;
  to: Date;
}

/** One source table: how its ids are listed in the window, and how one row is projected. */
interface Walk {
  source: ReprojectSource;
  ids(tx: Tx, window: Window, after: string | undefined, take: number): Promise<{ id: string }[]>;
  project(ctx: TenantContext, tx: Tx, envelope: EventEnvelope, id: string): Promise<void>;
}

function between(window: Window) {
  return { gte: window.from, lt: window.to };
}

/** Keyset paging on the id: stable however many rows the walk itself writes. */
function pastId(after: string | undefined) {
  return after ? { id: { gt: after } } : {};
}

const BY_ID = { id: 'asc' } as const;
const ID_ONLY = { id: true } as const;

const WALKS: Record<ReprojectSource, Walk> = {
  tickets: {
    source: 'tickets',
    ids: (tx, window, after, take) =>
      tx.ticket.findMany({ where: { createdAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    project: (ctx, tx, envelope, id) => refreshTicketFact(ctx, tx, envelope, id, {}, { rollups: false }),
  },
  timers: {
    source: 'timers',
    ids: (tx, window, after, take) =>
      tx.slaTimer.findMany({ where: { startedAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    async project(ctx, tx, envelope, id) {
      await refreshTimerFact(ctx, tx, envelope, id);
      // What `sla.timer.breached` would have done for this ticket, read from
      // the timer that breached.
      const timer = await tx.slaTimer.findFirst({ where: { id }, select: { ticketId: true, breachedAt: true } });
      if (timer?.breachedAt) await markBreached(ctx, tx, envelope, timer.ticketId, { rollups: false });
    },
  },
  approvals: {
    source: 'approvals',
    ids: (tx, window, after, take) =>
      tx.approvalRequest.findMany({ where: { requestedAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    project: (ctx, tx, envelope, id) => refreshApprovalFact(ctx, tx, envelope, id),
  },
  tasks: {
    source: 'tasks',
    ids: (tx, window, after, take) =>
      tx.ticketTask.findMany({ where: { createdAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    project: (ctx, tx, envelope, id) => refreshTaskFact(ctx, tx, envelope, id),
  },
  surveys: {
    source: 'surveys',
    ids: (tx, window, after, take) =>
      tx.surveyResponse.findMany({ where: { respondedAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    project: (ctx, tx, envelope, id) => refreshSurveyFact(ctx, tx, envelope, id),
  },
  time: {
    source: 'time',
    // Deleted entries too: their projection is the removal of the fact.
    ids: (tx, window, after, take) =>
      tx.timeEntry.findMany({ where: { loggedAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    project: (ctx, tx, envelope, id) => refreshTimeFact(ctx, tx, envelope, id),
  },
  notifications: {
    source: 'notifications',
    ids: (tx, window, after, take) =>
      tx.notification.findMany({ where: { createdAt: between(window), ...pastId(after) }, orderBy: BY_ID, select: ID_ONLY, take }),
    // The channel an event would have named is the in-app one every
    // notification is queued on; a delivery attempt, when there was one,
    // names its own and the projector prefers it.
    project: (ctx, tx, envelope, id) => refreshNotificationFact(ctx, tx, envelope, id, 'inapp'),
  },
};

/** The envelope a batch's projections are handed: an id for the cursor, and now. */
export function reprojectionEnvelope(ctx: TenantContext, source: ReprojectSource, window: Window): EventEnvelope {
  return {
    id: newId(),
    type: 'analytics.reprojected',
    version: 1,
    tenantId: ctx.tenantId,
    occurredAt: new Date().toISOString(),
    actor: ctx.actor,
    correlationId: ctx.correlationId,
    causationId: null,
    aggregate: { type: 'tenant', id: ctx.tenantId },
    payload: { source, from: window.from.toISOString(), to: window.to.toISOString() },
    meta: { source: 'replay' },
  };
}

/**
 * A batch that lost a race with another on a row both create on first sight
 * (a unique violation), or deadlocked with it. Anything else is a real failure.
 */
export function isRetryableConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2002' || code === 'P2034' || code === '23505' || code === '40P01' || code === '40001') return true;
  const message = error instanceof Error ? error.message : '';
  return /unique constraint|deadlock detected|could not serialize/i.test(message);
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function listIds(ctx: TenantContext, walk: Walk, window: Window): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const rows = await transaction(ctx, (tx) => walk.ids(tx, window, after, ID_PAGE));
    for (const row of rows) ids.push(row.id);
    if (rows.length < ID_PAGE) return ids;
    after = rows.at(-1)!.id;
  }
}

async function projectBatch(ctx: TenantContext, walk: Walk, window: Window, ids: string[]): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await transaction(
        ctx,
        async (tx) => {
          const envelope = reprojectionEnvelope(ctx, walk.source, window);
          for (const id of ids) await walk.project(ctx, tx, envelope, id);
        },
        { timeout: BATCH_TIMEOUT_MS },
      );
      return;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryableConflict(error)) throw error;
      metrics.increment('analytics_reproject_batch_retries_total', { source: walk.source });
      logger.debug('a reprojection batch met another on a shared row; running it again', { source: walk.source, attempt });
    }
  }
}

/**
 * Rebuilds the facts of one tenant from its source rows over a window, then
 * the rollup of every day in it (A4 §2.7). Returns how many rows of each
 * source were projected.
 *
 * The answer is the one the live projection gives for the same rows — the
 * integration suite (`tests/integration/demo-imports.test.ts`) holds it to
 * that — except where a fact is defined by when it was projected: a running
 * timer's elapsed minutes are measured to the moment of projection, live as
 * here.
 *
 * Needs `analytics.admin`. Ends by moving the metric cache's version on, so no
 * answer cached before the reprojection outlives it (A8 R4c).
 */
export async function reprojectFromSource(ctx: TenantContext, options: ReprojectOptions): Promise<ReprojectResult> {
  authz.require(ctx, 'analytics.admin');
  const window: Window = { from: options.from, to: options.to };
  const batch = options.batch ?? DEFAULT_BATCH;
  const parallelism = options.parallelism ?? 1;
  const sources = REPROJECT_SOURCES.filter((source) => (options.sources ?? REPROJECT_SOURCES).includes(source));

  if (!(window.from instanceof Date) || !(window.to instanceof Date) || Number.isNaN(window.from.getTime()) || Number.isNaN(window.to.getTime())) {
    throw new ValidationError('a reprojection needs a window with two instants', [{ field: 'from', code: 'invalid', message: 'from and to must be dates' }]);
  }
  if (window.from >= window.to) {
    throw new ValidationError('the window ends before it starts', [{ field: 'to', code: 'before_from', message: 'to must be after from' }]);
  }
  if (!Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH) {
    throw new ValidationError(`a batch is 1 to ${MAX_BATCH} rows`, [{ field: 'batch', code: 'out_of_range', message: `1 to ${MAX_BATCH}` }]);
  }
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > MAX_PARALLELISM) {
    throw new ValidationError(`parallelism is 1 to ${MAX_PARALLELISM}`, [{ field: 'parallelism', code: 'out_of_range', message: `1 to ${MAX_PARALLELISM}` }]);
  }
  for (const source of options.sources ?? []) {
    if (!REPROJECT_SOURCES.includes(source)) {
      throw new ValidationError(`not a source a reprojection walks: ${String(source)}`, [{ field: 'sources', code: 'unknown', message: String(source) }]);
    }
  }

  const result: ReprojectResult = { tickets: 0, timers: 0, approvals: 0, tasks: 0, surveys: 0, time: 0, notifications: 0, rollupDays: 0 };
  const started = Date.now();

  for (const source of sources) {
    const walk = WALKS[source];
    const ids = await listIds(ctx, walk, window);
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += batch) batches.push(ids.slice(index, index + batch));
    await mapLimit(batches, parallelism, (chunk) => projectBatch(ctx, walk, window, chunk));
    result[source] = ids.length;
    metrics.increment('analytics_reprojected_rows_total', { source }, ids.length);
  }

  // The rollup follows the ticket facts, which only tickets and breached
  // timers changed; it is rebuilt from them once, rather than diffed per row.
  if (result.tickets + result.timers > 0) {
    const rebuilt = await rebuildRange(ctx, window.from, window.to);
    result.rollupDays = rebuilt.days;
  }
  // After everything has committed (A8 R4c).
  await bumpQueryVersion(ctx.tenantId);

  logger.info('projection rebuilt from source rows', {
    tenantId: ctx.tenantId,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    ...result,
    ms: Date.now() - started,
  });
  return result;
}
