import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { TWENTY_FOUR_SEVEN, type BusinessCalendar } from '@itsm/business-time';
import { timerService } from '@itsm/module-sla';
import { dateKey, durationsBetween } from '../domain/durations.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';

/**
 * The ticket-task projector.
 *
 * Tasks are where a ticket's time actually goes, and a resolution time that
 * cannot be broken down into them is a number nobody can act on: "four days"
 * becomes "three of them waiting on the build team" only if the tasks are
 * measured separately.
 */

const PROJECTOR = 'task';

async function calendarFor(tx: Tx, teamId: string | null): Promise<BusinessCalendar> {
  if (!teamId) return TWENTY_FOUR_SEVEN;
  const team = await tx.team.findFirst({ where: { id: teamId }, select: { calendarId: true } });
  if (!team?.calendarId) return TWENTY_FOUR_SEVEN;
  return timerService.loadCalendar(tx, team.calendarId);
}

export async function refreshTaskFact(ctx: TenantContext, tx: Tx, event: EventEnvelope, taskId: string): Promise<void> {
  const task = await tx.ticketTask.findFirst({
    where: { id: taskId },
    select: { id: true, ticketId: true, assigneeId: true, groupId: true, createdAt: true, completedAt: true },
  });
  if (!task) {
    logger.debug('task for projection no longer exists', { taskId, type: event.type });
    return;
  }

  const occurredAt = new Date(event.occurredAt);
  const calendar = await calendarFor(tx, task.groupId);

  await dims.ensureTeam(tx, ctx.tenantId, task.groupId);
  await dims.ensureUser(tx, ctx.tenantId, task.assigneeId, occurredAt);
  await dims.ensureDate(tx, dateKey(task.createdAt));

  await facts.writeTaskFact(tx, ctx.tenantId, {
    id: (await facts.findTaskFact(tx, taskId))?.id,
    taskId: task.id,
    ticketId: task.ticketId,
    assigneeId: task.assigneeId,
    teamId: task.groupId,
    createdDate: dateKey(task.createdAt),
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    completionMinutes: task.completedAt
      ? durationsBetween(task.createdAt, task.completedAt, calendar).businessMinutes
      : null,
    lastEventId: event.id,
    lastEventAt: occurredAt,
  });

  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}
