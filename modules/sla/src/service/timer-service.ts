import {
  addBusinessMs,
  elapsedBusinessMs,
  TWENTY_FOUR_SEVEN,
  type BusinessCalendar,
  type OpenPeriod,
} from '@itsm/business-time';
import {
  type TenantContext,
  type Tx,
  logger,
  metrics,
  newId,
  NotFoundError,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { evaluate, events, type Expr } from '@itsm/contracts';
import { partitionFor } from '../manifest.js';

/**
 * MOD-07 timer engine.
 *
 * Due dates are materialised on the row so the minute scheduler can use a plain
 * range scan on a partial index rather than recomputing calendars for every
 * running timer (docs/architecture/12 §2).
 */

export type TargetType = 'response' | 'update' | 'restoration' | 'resolution' | 'fulfilment' | 'approval';

interface TicketForSla {
  id: string;
  orgId: string | null;
  type: string;
  priority: string;
  status: string;
  statusCategory: string;
  serviceId: string | null;
  categoryId: string | null;
  groupId: string | null;
  sourceChannel: string;
  createdAt: Date;
}

/** Picks the most specific published policy whose match expression holds. */
export async function matchPolicy(tx: Tx, ctx: TenantContext, ticket: TicketForSla) {
  const policies = await tx.slaPolicy.findMany({
    where: { status: 'published', OR: [{ orgId: { in: ctx.organisationIds } }, { orgId: null }] },
    orderBy: { specificity: 'desc' },
    include: { targets: true },
  });

  const context = {
    ticket,
    channel: ticket.sourceChannel,
    now: new Date().toISOString(),
  };

  for (const policy of policies) {
    try {
      if (evaluate(policy.match as Expr, context)) return policy;
    } catch (error) {
      logger.warn('SLA policy match expression failed; skipping policy', {
        policyKey: policy.key,
        error: (error as Error).message,
      });
    }
  }
  return null;
}

export async function loadCalendar(tx: Tx, calendarId: string | null): Promise<BusinessCalendar> {
  if (!calendarId) return TWENTY_FOUR_SEVEN;
  const calendar = await tx.businessCalendar.findFirst({
    where: { id: calendarId },
    include: { exceptions: true },
  });
  if (!calendar) return TWENTY_FOUR_SEVEN;
  return {
    timeZone: calendar.timeZone,
    hours: calendar.hours as unknown as BusinessCalendar['hours'],
    exceptions: calendar.exceptions.map((e) => ({
      date: e.date,
      type: e.type as 'holiday' | 'extended',
      ...(e.hours ? { hours: e.hours as unknown as OpenPeriod[] } : {}),
    })),
  };
}

/** Resolves which calendar applies: the assigned group's, else the policy's, else 24/7. */
async function calendarForTicket(tx: Tx, policy: { calendarMode: string; calendarId: string | null }, ticket: TicketForSla) {
  if (policy.calendarMode === 'group' && ticket.groupId) {
    const team = await tx.team.findFirst({ where: { id: ticket.groupId } });
    if (team?.calendarId) return { id: team.calendarId, calendar: await loadCalendar(tx, team.calendarId) };
  }
  return { id: policy.calendarId, calendar: await loadCalendar(tx, policy.calendarId) };
}

export async function startTimersForTicket(ctx: TenantContext, tx: Tx, ticketId: string): Promise<number> {
  const ticket = (await tx.ticket.findFirst({ where: { id: ticketId } })) as TicketForSla | null;
  if (!ticket) return 0;

  const policy = await matchPolicy(tx, ctx, ticket);
  if (!policy) {
    logger.debug('no SLA policy matched', { ticketId });
    return 0;
  }

  const targets = policy.targets.filter((t) => t.priority === ticket.priority);
  if (targets.length === 0) return 0;

  const { id: calendarId, calendar } = await calendarForTicket(tx, policy, ticket);
  const startedAt = new Date();
  let started = 0;

  for (const target of targets) {
    const existing = await tx.slaTimer.findFirst({ where: { ticketId, targetType: target.targetType } });
    if (existing) continue;

    const targetMs = target.minutes * 60_000;
    const dueAt = addBusinessMs(startedAt, targetMs, calendar);
    const timerId = newId();

    await tx.slaTimer.create({
      data: {
        id: timerId,
        tenantId: ctx.tenantId,
        ticketId,
        targetType: target.targetType,
        policyId: policy.id,
        policyVersion: policy.version,
        calendarId,
        targetMs,
        startedAt,
        lastResumedAt: startedAt,
        dueAt,
        remainingMs: targetMs,
        state: 'running',
        nextWarningAt: nextWarningInstant(startedAt, targetMs, target.warningThresholds, [], calendar),
        partition: partitionFor(ticketId),
      },
    });

    await publish(tx, ctx, {
      definition: events.slaTimerStarted,
      aggregateId: timerId,
      payload: {
        timerId,
        ticketId,
        targetType: target.targetType,
        dueAt: dueAt.toISOString(),
        policyId: policy.id,
      },
    });
    started += 1;
  }

  if (started > 0) {
    await tx.ticket.updateMany({ where: { id: ticketId }, data: { slaPolicyId: policy.id } });
    const resolution = await tx.slaTimer.findFirst({ where: { ticketId, targetType: 'resolution' } });
    if (resolution?.dueAt) {
      await tx.ticket.updateMany({ where: { id: ticketId }, data: { dueAt: resolution.dueAt } });
    }
  }

  metrics.increment('sla_timers_started_total', {}, started);
  return started;
}

/** The instant at which the next unfired warning threshold is reached. */
function nextWarningInstant(
  from: Date,
  remainingMs: number,
  thresholds: number[],
  fired: number[],
  calendar: BusinessCalendar,
): Date | null {
  const pending = thresholds.filter((t) => !fired.includes(t)).sort((a, b) => a - b);
  const next = pending[0];
  if (next === undefined) return null;
  // Thresholds are a percentage of the ORIGINAL target, measured from now
  // against what is left, which is what keeps them meaningful after a pause.
  const elapsedFraction = next / 100;
  const offset = Math.max(0, remainingMs * elapsedFraction);
  return addBusinessMs(from, offset, calendar);
}

export async function pauseTimers(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  reason: 'pending_requester' | 'pending_third_party' | 'pending_approval',
): Promise<number> {
  const timers = await tx.slaTimer.findMany({ where: { ticketId, state: 'running', targetType: { not: 'response' } } });
  const now = new Date();
  let paused = 0;

  for (const timer of timers) {
    const calendar = await loadCalendar(tx, timer.calendarId);
    const consumed = elapsedBusinessMs(timer.lastResumedAt ?? timer.startedAt, now, calendar);
    const remainingMs = Math.max(0, timer.remainingMs - consumed);

    await tx.slaTimer.update({
      where: { id: timer.id },
      data: {
        state: 'paused',
        pausedAt: now,
        elapsedMs: timer.elapsedMs + consumed,
        remainingMs,
        dueAt: null,
        nextWarningAt: null,
        version: { increment: 1 },
      },
    });
    await tx.slaPause.create({
      data: { id: newId(), tenantId: ctx.tenantId, timerId: timer.id, reason, from: now },
    });
    await publish(tx, ctx, {
      definition: events.slaTimerPaused,
      aggregateId: timer.id,
      payload: { timerId: timer.id, ticketId, targetType: timer.targetType, reason, remainingMs },
    });
    paused += 1;
  }
  return paused;
}

export async function resumeTimers(ctx: TenantContext, tx: Tx, ticketId: string): Promise<number> {
  const timers = await tx.slaTimer.findMany({ where: { ticketId, state: 'paused' } });
  const now = new Date();
  let resumed = 0;

  for (const timer of timers) {
    const calendar = await loadCalendar(tx, timer.calendarId);
    const dueAt = addBusinessMs(now, timer.remainingMs, calendar);
    const target = await tx.slaTarget.findFirst({ where: { policyId: timer.policyId, targetType: timer.targetType } });

    await tx.slaTimer.update({
      where: { id: timer.id },
      data: {
        state: 'running',
        pausedAt: null,
        lastResumedAt: now,
        dueAt,
        nextWarningAt: nextWarningInstant(now, timer.remainingMs, target?.warningThresholds ?? [], timer.warningsFired, calendar),
        version: { increment: 1 },
      },
    });
    await tx.slaPause.updateMany({ where: { timerId: timer.id, to: null }, data: { to: now } });
    await publish(tx, ctx, {
      definition: events.slaTimerResumed,
      aggregateId: timer.id,
      payload: { timerId: timer.id, ticketId, targetType: timer.targetType, dueAt: dueAt.toISOString() },
    });
    resumed += 1;
  }
  return resumed;
}

/** Marks a target met. Used when an agent replies, or when a ticket resolves. */
export async function meetTimer(ctx: TenantContext, tx: Tx, ticketId: string, targetType: TargetType): Promise<boolean> {
  const timer = await tx.slaTimer.findFirst({ where: { ticketId, targetType, state: { in: ['running', 'paused'] } } });
  if (!timer) return false;

  const now = new Date();
  await tx.slaTimer.update({
    where: { id: timer.id },
    data: { state: 'met', metAt: now, dueAt: null, nextWarningAt: null, version: { increment: 1 } },
  });
  await publish(tx, ctx, {
    definition: events.slaTimerMet,
    aggregateId: timer.id,
    payload: { timerId: timer.id, ticketId, targetType, metAt: now.toISOString() },
  });
  metrics.increment('sla_timers_met_total', { target: targetType });
  return true;
}

export async function stopTimers(ctx: TenantContext, tx: Tx, ticketId: string, outcome: 'met' | 'cancelled'): Promise<number> {
  const timers = await tx.slaTimer.findMany({ where: { ticketId, state: { in: ['running', 'paused'] } } });
  const now = new Date();

  for (const timer of timers) {
    await tx.slaTimer.update({
      where: { id: timer.id },
      data: {
        state: outcome,
        ...(outcome === 'met' ? { metAt: now } : {}),
        dueAt: null,
        nextWarningAt: null,
        version: { increment: 1 },
      },
    });
    if (outcome === 'met') {
      await publish(tx, ctx, {
        definition: events.slaTimerMet,
        aggregateId: timer.id,
        payload: { timerId: timer.id, ticketId, targetType: timer.targetType, metAt: now.toISOString() },
      });
    }
  }
  return timers.length;
}

export interface TickResult {
  warnings: number;
  breaches: number;
  maxLatenessMs: number;
}

/**
 * Processes one partition: fires due warnings and breaches.
 *
 * Lateness is measured and exported because "a warning is never delivered more
 * than 60 seconds late" is the module's stated service level (MOD-07-E1-S2).
 */
export async function tickPartition(ctx: TenantContext, partition: number, limit = 5000): Promise<TickResult> {
  const now = new Date();
  const result: TickResult = { warnings: 0, breaches: 0, maxLatenessMs: 0 };

  await transaction(ctx, async (tx) => {
    const due = await tx.slaTimer.findMany({
      where: {
        partition,
        state: 'running',
        OR: [{ dueAt: { lte: now } }, { nextWarningAt: { lte: now } }],
      },
      take: limit,
    });

    for (const timer of due) {
      const target = await tx.slaTarget.findFirst({ where: { policyId: timer.policyId, targetType: timer.targetType } });
      const calendar = await loadCalendar(tx, timer.calendarId);

      if (timer.dueAt && timer.dueAt <= now) {
        const lateness = now.getTime() - timer.dueAt.getTime();
        result.maxLatenessMs = Math.max(result.maxLatenessMs, lateness);

        await tx.slaTimer.update({
          where: { id: timer.id },
          data: { state: 'breached', breachedAt: now, nextWarningAt: null, version: { increment: 1 } },
        });
        await tx.breachRecord.create({
          data: { id: newId(), tenantId: ctx.tenantId, timerId: timer.id, ticketId: timer.ticketId, breachedAt: now },
        });
        await publish(tx, ctx, {
          definition: events.slaTimerBreached,
          aggregateId: timer.id,
          payload: {
            timerId: timer.id,
            ticketId: timer.ticketId,
            targetType: timer.targetType,
            dueAt: timer.dueAt.toISOString(),
          },
        });
        result.breaches += 1;
        continue;
      }

      if (timer.nextWarningAt && timer.nextWarningAt <= now) {
        const thresholds = target?.warningThresholds ?? [];
        const pending = thresholds.filter((t) => !timer.warningsFired.includes(t)).sort((a, b) => a - b);
        const fired = pending[0];
        if (fired === undefined) {
          await tx.slaTimer.update({ where: { id: timer.id }, data: { nextWarningAt: null } });
          continue;
        }

        const lateness = now.getTime() - timer.nextWarningAt.getTime();
        result.maxLatenessMs = Math.max(result.maxLatenessMs, lateness);
        const warningsFired = [...timer.warningsFired, fired];
        const remaining = timer.dueAt ? Math.max(0, timer.dueAt.getTime() - now.getTime()) : timer.remainingMs;

        await tx.slaTimer.update({
          where: { id: timer.id },
          data: {
            warningsFired,
            nextWarningAt: nextWarningInstant(now, timer.remainingMs, thresholds, warningsFired, calendar),
            version: { increment: 1 },
          },
        });
        await publish(tx, ctx, {
          definition: events.slaTimerWarning,
          aggregateId: timer.id,
          payload: {
            timerId: timer.id,
            ticketId: timer.ticketId,
            targetType: timer.targetType,
            dueAt: (timer.dueAt ?? now).toISOString(),
            threshold: fired,
            remainingMs: remaining,
          },
        });
        result.warnings += 1;
      }
    }
  });

  if (result.maxLatenessMs > 0) metrics.observe('sla_timer_lateness_ms', result.maxLatenessMs, { partition: String(partition) });
  return result;
}

export async function listTimersForTicket(ctx: TenantContext, ticketId: string) {
  return transaction(ctx, (tx) => tx.slaTimer.findMany({ where: { ticketId }, orderBy: { targetType: 'asc' } }));
}

export async function excuseBreach(ctx: TenantContext, timerId: string, reasonCode: string, reason: string) {
  return transaction(ctx, async (tx) => {
    const record = await tx.breachRecord.findFirst({ where: { timerId } });
    if (!record) throw new NotFoundError('breach record', timerId);
    const updated = await tx.breachRecord.update({
      where: { id: record.id },
      data: { reasonCode, excusedBy: ctx.actor.id, excuseReason: reason, excusedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: 'sla.breach.excused',
      targetType: 'sla_timer',
      targetId: timerId,
      after: { reasonCode, reason },
      reason,
    });
    return updated;
  });
}
