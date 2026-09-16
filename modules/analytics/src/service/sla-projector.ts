import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { TWENTY_FOUR_SEVEN, type BusinessCalendar } from '@itsm/business-time';
import { timerService } from '@itsm/module-sla';
import { dateKey, durationsBetween, marginMinutes } from '../domain/durations.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';

/**
 * The SLA timer projector.
 *
 * `fact_sla_timer` answers attainment: what fraction of targets were met, by
 * team, by priority, by service. It is measured against the policy's own
 * calendar, because attainment is a question about the promise that was made
 * and the promise named a calendar.
 *
 * Timers that are still running get a row too. "How many are at risk right
 * now" is a question about the ones without an outcome yet, and a fact table
 * that only recorded finished timers could not answer it.
 */

const PROJECTOR = 'sla';

interface TimerSource {
  id: string;
  ticketId: string;
  targetType: string;
  policyId: string;
  calendarId: string | null;
  startedAt: Date;
  dueAt: Date | null;
  state: string;
  metAt: Date | null;
  breachedAt: Date | null;
}

async function loadTimer(tx: Tx, timerId: string): Promise<TimerSource | null> {
  return tx.slaTimer.findFirst({
    where: { id: timerId },
    select: {
      id: true,
      ticketId: true,
      targetType: true,
      policyId: true,
      calendarId: true,
      startedAt: true,
      dueAt: true,
      state: true,
      metAt: true,
      breachedAt: true,
    },
  }) as Promise<TimerSource | null>;
}

/**
 * Total time the timer spent paused, in business minutes.
 *
 * Kept as its own figure rather than folded into the duration, because
 * "we were waiting on the customer for three days" is the answer to most breach
 * questions, and a number that hides it is a number that starts arguments in
 * a service review.
 */
async function pausedMinutesFor(tx: Tx, timerId: string, calendar: BusinessCalendar, until: Date): Promise<number> {
  const pauses = await tx.slaPause.findMany({ where: { timerId }, select: { from: true, to: true } });
  let total = 0;
  for (const pause of pauses) {
    const to = pause.to ?? until;
    total += durationsBetween(pause.from, to, calendar).businessMinutes;
  }
  return total;
}

async function calendarFor(tx: Tx, calendarId: string | null): Promise<BusinessCalendar> {
  if (!calendarId) return TWENTY_FOUR_SEVEN;
  return timerService.loadCalendar(tx, calendarId);
}

export async function refreshTimerFact(
  ctx: TenantContext,
  tx: Tx,
  event: EventEnvelope,
  timerId: string,
): Promise<void> {
  const timer = await loadTimer(tx, timerId);
  if (!timer) {
    logger.debug('sla timer for projection no longer exists', { timerId, type: event.type });
    return;
  }

  const ticket = await tx.ticket.findFirst({
    where: { id: timer.ticketId },
    select: { priority: true, groupId: true, serviceId: true },
  });

  const occurredAt = new Date(event.occurredAt);
  const calendar = await calendarFor(tx, timer.calendarId);
  const stoppedAt = timer.metAt ?? timer.breachedAt ?? null;
  const outcome = timer.metAt ? 'met' : timer.breachedAt ? 'breached' : 'running';
  const paused = await pausedMinutesFor(tx, timerId, calendar, stoppedAt ?? occurredAt);
  const elapsed = durationsBetween(timer.startedAt, stoppedAt ?? occurredAt, calendar);

  await dims.ensureTeam(tx, ctx.tenantId, ticket?.groupId ?? null);
  await dims.ensureService(tx, ctx.tenantId, ticket?.serviceId ?? null);
  await dims.ensureDate(tx, dateKey(timer.startedAt));

  await facts.writeTimerFact(tx, ctx.tenantId, {
    id: (await facts.findTimerFact(tx, timerId))?.id,
    tenantId: ctx.tenantId,
    timerId: timer.id,
    ticketId: timer.ticketId,
    policyId: timer.policyId,
    target: timer.targetType,
    priority: ticket?.priority ?? null,
    teamId: ticket?.groupId ?? null,
    serviceId: ticket?.serviceId ?? null,
    startedDate: dateKey(timer.startedAt),
    startedAt: timer.startedAt,
    dueAt: timer.dueAt,
    stoppedAt,
    outcome,
    // The working time the target consumed, less the time it was stopped.
    pausedMinutes: paused,
    businessMinutes: Math.max(0, elapsed.businessMinutes - paused),
    marginMinutes: marginMinutes(timer.dueAt, stoppedAt),
    lastEventId: event.id,
    lastEventAt: occurredAt,
  });

  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}
