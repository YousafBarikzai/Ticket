import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { dateKey } from '../domain/durations.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';

/** Time entries, one fact each, read back from MOD-19's row; a deletion removes the fact. */

const PROJECTOR = 'time';

export async function refreshTimeFact(ctx: TenantContext, tx: Tx, event: EventEnvelope, entryId: string): Promise<void> {
  const entry = await tx.timeEntry.findFirst({ where: { id: entryId } });
  const occurredAt = new Date(event.occurredAt);

  if (!entry || entry.deletedAt) {
    await facts.deleteTimeFact(tx, entryId);
    await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
    if (!entry) logger.debug('time entry for projection no longer exists', { entryId, type: event.type });
    return;
  }

  const ticket = await tx.ticket.findFirst({ where: { id: entry.ticketId }, select: { groupId: true, serviceId: true } });
  const activity = await tx.activityType.findFirst({ where: { id: entry.activityTypeId }, select: { key: true } });

  await dims.ensureTeam(tx, ctx.tenantId, ticket?.groupId ?? null);
  await dims.ensureService(tx, ctx.tenantId, ticket?.serviceId ?? null);
  await dims.ensureUser(tx, ctx.tenantId, entry.userId, occurredAt);
  await dims.ensureDate(tx, dateKey(entry.loggedAt));

  await facts.writeTimeFact(tx, ctx.tenantId, {
    id: (await facts.findTimeFact(tx, entryId))?.id,
    entryId: entry.id,
    ticketId: entry.ticketId,
    taskId: entry.taskId,
    userId: entry.userId,
    teamId: ticket?.groupId ?? null,
    serviceId: ticket?.serviceId ?? null,
    activityKey: activity?.key ?? 'unknown',
    kind: entry.kind,
    minutes: entry.minutes,
    cost: entry.cost,
    currency: entry.currency,
    billable: entry.billable,
    loggedDate: dateKey(entry.loggedAt),
    loggedAt: entry.loggedAt,
    lastEventId: event.id,
    lastEventAt: occurredAt,
  });

  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}
