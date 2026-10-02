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
import { STATES } from '@itsm/module-ticket';
import { partitionFor } from '../manifest.js';
import { applyEscalations } from './escalation-service.js';

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

  // The service is read by key as well as by id, because a policy written by
  // a person — or shipped in an ESM pack, which cannot know a tenant's
  // identifiers — says `ticket.serviceKey eq 'hr'` rather than pasting a UUID
  // that means nothing to whoever reads the policy next.
  const service = ticket.serviceId ? await tx.service.findFirst({ where: { id: ticket.serviceId } }) : null;

  const context = {
    ticket: { ...ticket, serviceKey: service?.key ?? null },
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

export interface RematchResult {
  /** The policy the ticket matches now, or null when none does and nothing changed. */
  policyId: string | null;
  /** Running or paused timers moved onto the new target. */
  retargeted: number;
  /** Targets the ticket had no timer for, started from when it was raised. */
  started: number;
  /** Running or paused timers for targets the new policy does not define. */
  cancelled: number;
}

/**
 * Re-matches a ticket's SLA after it was classified (ADR-0051).
 *
 * An AI decision in `auto` mode can set a new ticket's category and team a
 * few seconds after it was raised, and a policy may match on either. **The
 * clock started at creation and keeps running**: business time already used
 * is kept, and only the policy, the target and so the due time change. A
 * ticket must not earn extra time because a model was slow to classify it,
 * and must not lose time it was promised either. A target that is now
 * already overdue has its due time set to now, and the next tick breaches it
 * as it would have been breached.
 *
 * Timers already met, breached or cancelled are history and are left alone.
 * **A running or paused timer whose target the new policy does not define is
 * cancelled** (F1 U8, ADR-0057), publishing `sla.timer.cancelled`: only the
 * targets the current policy defines are counted. Left running, a ticket
 * re-matched to a policy without an `update` target kept an `update` timer
 * that later breached and dragged attainment down for a promise nobody made.
 * A ticket that matches no policy keeps what it has: a classification is a
 * reason to re-check, not a reason to take a promise away.
 *
 * An `update` timer past its first cycle is measured from the start of its
 * current cycle, because that is when the current promise was made.
 */
export async function rematchTimersForTicket(ctx: TenantContext, tx: Tx, ticketId: string): Promise<RematchResult> {
  const result: RematchResult = { policyId: null, retargeted: 0, started: 0, cancelled: 0 };
  const ticket = (await tx.ticket.findFirst({ where: { id: ticketId } })) as TicketForSla | null;
  if (!ticket) return result;
  const state = STATES[ticket.status as keyof typeof STATES];
  if (!state || state.sla.resolutionTimer === 'stopped' || state.sla.resolutionTimer === 'cancelled') return result;

  const policy = await matchPolicy(tx, ctx, ticket);
  if (!policy) return result;
  result.policyId = policy.id;

  const targets = policy.targets.filter((t) => t.priority === ticket.priority);
  const { id: calendarId, calendar } = await calendarForTicket(tx, policy, ticket);
  const timers = await tx.slaTimer.findMany({ where: { ticketId } });
  const now = new Date();
  const before = { policyId: timers[0]?.policyId ?? null, dueAt: timers.find((t) => t.targetType === 'resolution')?.dueAt ?? null };

  for (const target of targets) {
    const targetMs = target.minutes * 60_000;
    const timer = timers.find((t) => t.targetType === target.targetType);

    if (!timer) {
      // A target the ticket never had a timer for: it runs from when the
      // ticket was raised, as it would have if the ticket had arrived
      // classified. Only while the clock is running; a pending ticket's
      // timers start again when it does.
      if (state.sla.resolutionTimer !== 'running') continue;
      const startedAt = ticket.createdAt;
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
        payload: { timerId, ticketId, targetType: target.targetType, dueAt: dueAt.toISOString(), policyId: policy.id },
      });
      result.started += 1;
      continue;
    }

    if (timer.state !== 'running' && timer.state !== 'paused') continue;
    if (timer.policyId === policy.id && timer.targetMs === targetMs && timer.calendarId === calendarId) continue;

    // Business time used so far, as if the new policy had applied from the
    // start: creation to now on the new calendar, less the time the ticket
    // spent paused. Counting it on the old calendar instead would let a
    // ticket raised out of hours and matched to a round-the-clock policy
    // keep the evening it arrived in. What is left of the target is measured
    // the same way from the start of the current cycle, which for every
    // timer but a restarted `update` one is the same instant.
    const running = timer.state === 'running';
    const pauses = await tx.slaPause.findMany({ where: { timerId: timer.id }, select: { from: true, to: true } });
    const usedSince = (from: Date): number => {
      const paused = pauses.reduce((sum, pause) => {
        const start = pause.from > from ? pause.from : from;
        const end = pause.to ?? now;
        return end > start ? sum + elapsedBusinessMs(start, end, calendar) : sum;
      }, 0);
      return Math.max(0, elapsedBusinessMs(from, now, calendar) - paused);
    };
    const used = usedSince(timer.startedAt);
    const remainingMs = Math.max(0, targetMs - (timer.cycleStartedAt ? usedSince(timer.cycleStartedAt) : used));

    await tx.slaTimer.update({
      where: { id: timer.id },
      data: {
        policyId: policy.id,
        policyVersion: policy.version,
        calendarId,
        targetMs,
        remainingMs,
        elapsedMs: used,
        ...(running
          ? {
              // Banked as a pause would bank it, then running again from now
              // against what is left of the new target.
              lastResumedAt: now,
              dueAt: addBusinessMs(now, remainingMs, calendar),
              nextWarningAt: nextWarningInstant(now, remainingMs, target.warningThresholds, timer.warningsFired, calendar),
            }
          : {}),
        version: { increment: 1 },
      },
    });
    result.retargeted += 1;
  }

  const defined = new Set(targets.map((target) => target.targetType));
  for (const timer of timers) {
    if (defined.has(timer.targetType)) continue;
    if (timer.state !== 'running' && timer.state !== 'paused') continue;
    await cancelTimer(ctx, tx, timer);
    result.cancelled += 1;
  }

  if (result.retargeted + result.started + result.cancelled > 0) {
    await tx.ticket.updateMany({ where: { id: ticketId }, data: { slaPolicyId: policy.id } });
    const resolution = await tx.slaTimer.findFirst({ where: { ticketId, targetType: 'resolution' } });
    if (resolution?.dueAt) {
      await tx.ticket.updateMany({ where: { id: ticketId }, data: { dueAt: resolution.dueAt } });
    }
    await recordAudit(tx, ctx, {
      action: 'sla.timers.rematched',
      targetType: 'ticket',
      targetId: ticketId,
      before,
      after: {
        policyId: policy.id,
        dueAt: resolution?.dueAt ?? null,
        retargeted: result.retargeted,
        started: result.started,
        cancelled: result.cancelled,
      },
      reason: 'the ticket was classified after it was raised; the clock kept running from creation',
    });
    metrics.increment('sla_timers_rematched_total', {}, result.retargeted + result.started + result.cancelled);
  }
  return result;
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

  // The ticket's own due time is the resolution timer's, copied so lists can
  // sort and filter on it. While that timer is paused it has no due time, and
  // neither has the ticket: a stale value would put a ticket that is waiting
  // on its requester at the top of "due soon" (R2a).
  if (timers.some((timer) => timer.targetType === 'resolution')) {
    await tx.ticket.updateMany({ where: { id: ticketId }, data: { dueAt: null } });
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
    // The other half of R2a: the ticket's due time comes back with the
    // resolution timer's new one.
    if (timer.targetType === 'resolution') {
      await tx.ticket.updateMany({ where: { id: ticketId }, data: { dueAt } });
    }
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

/**
 * Stops every running or paused timer when the ticket resolves (`met`) or is
 * cancelled.
 *
 * Two rules from F1 (ADR-0057). **A verdict, once given, is final** (U6): an
 * `update` timer that missed a cycle keeps running for the cadence (U5), but
 * at resolution it ends `breached`, with `metAt` recording when it stopped and
 * no `sla.timer.met`, so it counts once and as missed. **A cancelled timer is
 * no verdict at all** (U7): it publishes `sla.timer.cancelled` so reporting
 * stops counting it as running, and attainment leaves it out.
 */
/** The timer fields the next `update` cycle is computed from. */
export interface CycleTimer {
  state: string;
  targetMs: number;
  elapsedMs: number;
  startedAt: Date;
  lastResumedAt: Date | null;
  pausedAt: Date | null;
  cycle: number;
}

/** The row an `update` timer becomes when its next cycle starts. */
export interface UpdateCycleRestart {
  state: 'running' | 'paused';
  elapsedMs: number;
  remainingMs: number;
  lastResumedAt: Date | null;
  pausedAt: Date | null;
  dueAt: Date | null;
  warningsFired: number[];
  nextWarningAt: Date | null;
  cycle: number;
  cycleStartedAt: Date;
  /** How the cycle that just closed ended. */
  previous: 'met' | 'breached';
  /**
   * The timer was breached, so it was never paused with the ticket; it now
   * pauses, and needs the pause row a paused timer always has.
   */
  opensPause: boolean;
}

/**
 * Computes the next cycle of an `update` timer (F1 U3, U5).
 *
 * Pure, so the business-time edge cases — a reply a minute before the
 * weekend, a day an hour longer than the others — are tested without a
 * database. The business time the closing cycle consumed is banked into
 * `elapsedMs`; the new cycle gets the whole target again, from `at`.
 *
 * - From `running`: the new cycle runs from `at`.
 * - From `paused` (the agent replied while the ticket waits on someone): the
 *   new cycle has no due time until `resumeTimers` gives it one, with the
 *   whole target.
 * - From `breached` (a cycle was missed, U5): the cadence carries on, running
 *   again, or paused when the ticket is waiting on someone. `breachedAt` is
 *   not touched, so the verdict stays breached.
 */
export function nextUpdateCycle(
  timer: CycleTimer,
  options: { at: Date; calendar: BusinessCalendar; thresholds: number[]; ticketPaused: boolean },
): UpdateCycleRestart {
  const { at, calendar, thresholds, ticketPaused } = options;
  const wasPaused = timer.state === 'paused';
  const consumed = wasPaused ? 0 : Math.max(0, elapsedBusinessMs(timer.lastResumedAt ?? timer.startedAt, at, calendar));
  const resumes = wasPaused ? false : timer.state === 'breached' ? !ticketPaused : true;
  const base = {
    elapsedMs: timer.elapsedMs + consumed,
    remainingMs: timer.targetMs,
    warningsFired: [] as number[],
    cycle: timer.cycle + 1,
    cycleStartedAt: at,
    previous: timer.state === 'breached' ? ('breached' as const) : ('met' as const),
  };

  if (resumes) {
    return {
      ...base,
      state: 'running',
      lastResumedAt: at,
      pausedAt: null,
      dueAt: addBusinessMs(at, timer.targetMs, calendar),
      nextWarningAt: nextWarningInstant(at, timer.targetMs, thresholds, [], calendar),
      opensPause: false,
    };
  }
  return {
    ...base,
    state: 'paused',
    lastResumedAt: timer.lastResumedAt,
    pausedAt: wasPaused ? timer.pausedAt ?? at : at,
    dueAt: null,
    nextWarningAt: null,
    opensPause: !wasPaused,
  };
}

/**
 * An agent's public reply meets the current `update` cycle and starts the
 * next, on the same row (F1 U1–U5, ADR-0057).
 *
 * Before this, nothing ever met or restarted an `update` timer: it stopped
 * only at resolution, so it behaved as a second, shorter resolution clock and
 * every P3 open longer than a working day breached it. The promise an update
 * target makes is "you will hear from us at least this often", and it is kept
 * by replying.
 *
 * Nothing restarts on a ticket that has its verdicts (resolved, closed or
 * cancelled), or on a timer that has stopped: a reply after resolution does
 * not reopen a promise that was already judged. Returns whether a cycle
 * restarted.
 */
export async function restartUpdateCycle(ctx: TenantContext, tx: Tx, ticketId: string, at: Date = new Date()): Promise<boolean> {
  const timer = await tx.slaTimer.findFirst({
    where: { ticketId, targetType: 'update', state: { in: ['running', 'paused', 'breached'] }, metAt: null },
  });
  if (!timer) return false;

  const ticket = await tx.ticket.findFirst({ where: { id: ticketId }, select: { status: true } });
  const definition = ticket ? STATES[ticket.status as keyof typeof STATES] : undefined;
  if (!definition) return false;
  const clock = definition.sla.resolutionTimer;
  if (clock === 'stopped' || clock === 'cancelled') return false;

  const calendar = await loadCalendar(tx, timer.calendarId);
  const target = await tx.slaTarget.findFirst({ where: { policyId: timer.policyId, targetType: 'update' } });
  const next = nextUpdateCycle(timer, {
    at,
    calendar,
    thresholds: target?.warningThresholds ?? [],
    ticketPaused: clock === 'paused',
  });

  await tx.slaTimer.update({
    where: { id: timer.id },
    data: {
      state: next.state,
      elapsedMs: next.elapsedMs,
      remainingMs: next.remainingMs,
      lastResumedAt: next.lastResumedAt,
      pausedAt: next.pausedAt,
      dueAt: next.dueAt,
      warningsFired: next.warningsFired,
      nextWarningAt: next.nextWarningAt,
      cycle: next.cycle,
      cycleStartedAt: next.cycleStartedAt,
      version: { increment: 1 },
    },
  });
  if (next.opensPause) {
    await tx.slaPause.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        timerId: timer.id,
        reason: definition.sla.pauseReason ?? 'pending_requester',
        from: at,
      },
    });
  }
  await publish(tx, ctx, {
    definition: events.slaTimerRestarted,
    aggregateId: timer.id,
    payload: {
      timerId: timer.id,
      ticketId,
      targetType: 'update',
      cycle: next.cycle,
      dueAt: next.dueAt?.toISOString() ?? null,
      previous: next.previous,
    },
  });
  metrics.increment('sla_update_cycles_restarted_total', { previous: next.previous });
  return true;
}

export async function stopTimers(ctx: TenantContext, tx: Tx, ticketId: string, outcome: 'met' | 'cancelled'): Promise<number> {
  const timers = await tx.slaTimer.findMany({ where: { ticketId, state: { in: ['running', 'paused'] } } });
  const now = new Date();

  for (const timer of timers) {
    if (outcome === 'met' && timer.breachedAt) {
      await tx.slaTimer.update({
        where: { id: timer.id },
        data: { state: 'breached', metAt: now, dueAt: null, nextWarningAt: null, version: { increment: 1 } },
      });
      continue;
    }
    if (outcome === 'cancelled') {
      await cancelTimer(ctx, tx, timer);
      continue;
    }
    await tx.slaTimer.update({
      where: { id: timer.id },
      data: { state: 'met', metAt: now, dueAt: null, nextWarningAt: null, version: { increment: 1 } },
    });
    await publish(tx, ctx, {
      definition: events.slaTimerMet,
      aggregateId: timer.id,
      payload: { timerId: timer.id, ticketId, targetType: timer.targetType, metAt: now.toISOString() },
    });
  }
  return timers.length;
}

/** Stops one timer without a verdict and says so (F1 U7, U8). */
async function cancelTimer(
  ctx: TenantContext,
  tx: Tx,
  timer: { id: string; ticketId: string; targetType: string },
): Promise<void> {
  await tx.slaTimer.update({
    where: { id: timer.id },
    data: { state: 'cancelled', dueAt: null, nextWarningAt: null, version: { increment: 1 } },
  });
  await publish(tx, ctx, {
    definition: events.slaTimerCancelled,
    aggregateId: timer.id,
    payload: { timerId: timer.id, ticketId: timer.ticketId, targetType: timer.targetType },
  });
  metrics.increment('sla_timers_cancelled_total', { target: timer.targetType });
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
        if (timer.targetType === 'update') metrics.increment('sla_update_cycles_missed_total');

        // A later cycle of an `update` timer that has already breached (F1
        // U4): the target is breached once. The row shows the miss, but there
        // is no second breach record, no second event and no second
        // escalation — the requester was let down once, and the team was told
        // once. The next agent reply starts the cadence again (U5).
        if (timer.breachedAt) {
          await tx.slaTimer.update({
            where: { id: timer.id },
            data: { state: 'breached', nextWarningAt: null, version: { increment: 1 } },
          });
          continue;
        }

        await tx.slaTimer.update({
          where: { id: timer.id },
          data: { state: 'breached', breachedAt: now, nextWarningAt: null, version: { increment: 1 } },
        });
        await tx.breachRecord.create({
          data: { id: newId(), tenantId: ctx.tenantId, timerId: timer.id, ticketId: timer.ticketId, breachedAt: now },
        });
        const breachEventId = await publish(tx, ctx, {
          definition: events.slaTimerBreached,
          aggregateId: timer.id,
          payload: {
            timerId: timer.id,
            ticketId: timer.ticketId,
            targetType: timer.targetType,
            dueAt: timer.dueAt.toISOString(),
          },
        });
        await applyEscalations(ctx, tx, {
          policyId: timer.policyId,
          ticketId: timer.ticketId,
          timerId: timer.id,
          on: 'breach',
          eventId: breachEventId,
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
        const warningEventId = await publish(tx, ctx, {
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
        await applyEscalations(ctx, tx, {
          policyId: timer.policyId,
          ticketId: timer.ticketId,
          timerId: timer.id,
          // Escalations are registered per threshold, so one policy can warn at
          // 75 per cent and reassign at 90 without needing two policies.
          on: `warning:${fired}`,
          eventId: warningEventId,
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
