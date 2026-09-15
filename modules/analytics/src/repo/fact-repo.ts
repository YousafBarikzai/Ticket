import type { Prisma, Tx } from '@itsm/platform';
import { newId } from '@itsm/platform';

/**
 * The fact tables.
 *
 * Writes only; the read side is MOD-12-E1b. Every write carries the event that
 * caused it, so a redelivery is a no-op rather than a second count.
 */

/**
 * A row as a projector supplies it: the identifier is minted on first write and
 * carried on every later one, and the tenant comes from the context rather than
 * the caller.
 */
type WriteRow<T extends { id: string; tenantId: string }> = Omit<T, 'id' | 'tenantId'> & {
  id?: string;
  tenantId?: string;
};

export interface FactTicketRow {
  id: string;
  ticketId: string;
  number: string;
  type: string;
  priority: string | null;
  status: string;
  serviceId: string | null;
  categoryId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  requesterId: string | null;
  channel: string | null;
  createdDate: Date;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  timeToFirstResponseMinutes: number | null;
  timeToResolveMinutes: number | null;
  elapsedToResolveMinutes: number | null;
  reopenCount: number;
  commentCount: number;
  breached: boolean;
  lastEventId: string;
  lastEventAt: Date;
}

export async function findTicketFact(tx: Tx, ticketId: string): Promise<FactTicketRow | null> {
  return tx.factTicket.findFirst({ where: { ticketId } }) as Promise<FactTicketRow | null>;
}

export async function writeTicketFact(
  tx: Tx,
  tenantId: string,
  row: Omit<FactTicketRow, 'id'> & { id?: string },
): Promise<void> {
  const { id: _ignored, ...data } = row;
  await tx.factTicket.upsert({
    where: { tenantId_ticketId: { tenantId, ticketId: row.ticketId } },
    create: { id: row.id ?? newId(), tenantId, ...data },
    update: data,
  });
}

export async function findTimerFact(tx: Tx, timerId: string) {
  return tx.factSlaTimer.findFirst({ where: { timerId } });
}

export async function writeTimerFact(
  tx: Tx,
  tenantId: string,
  row: WriteRow<Prisma.FactSlaTimerUncheckedCreateInput>,
): Promise<void> {
  const { id, tenantId: _tenant, ...data } = row;
  await tx.factSlaTimer.upsert({
    where: { tenantId_timerId: { tenantId, timerId: row.timerId } },
    create: { id: id ?? newId(), tenantId, ...data },
    update: data,
  });
}

export async function findApprovalFact(tx: Tx, requestId: string) {
  return tx.factApproval.findFirst({ where: { requestId } });
}

export async function writeApprovalFact(
  tx: Tx,
  tenantId: string,
  row: WriteRow<Prisma.FactApprovalUncheckedCreateInput>,
): Promise<void> {
  const { id, tenantId: _tenant, ...data } = row;
  await tx.factApproval.upsert({
    where: { tenantId_requestId: { tenantId, requestId: row.requestId } },
    create: { id: id ?? newId(), tenantId, ...data },
    update: data,
  });
}

export async function findTaskFact(tx: Tx, taskId: string) {
  return tx.factTask.findFirst({ where: { taskId } });
}

export async function writeTaskFact(tx: Tx, tenantId: string, row: WriteRow<Prisma.FactTaskUncheckedCreateInput>): Promise<void> {
  const { id, tenantId: _tenant, ...data } = row;
  await tx.factTask.upsert({
    where: { tenantId_taskId: { tenantId, taskId: row.taskId } },
    create: { id: id ?? newId(), tenantId, ...data },
    update: data,
  });
}

export async function findNotificationFact(tx: Tx, notificationId: string) {
  return tx.factNotification.findFirst({ where: { notificationId } });
}

export async function writeNotificationFact(
  tx: Tx,
  tenantId: string,
  row: WriteRow<Prisma.FactNotificationUncheckedCreateInput>,
): Promise<void> {
  const { id, tenantId: _tenant, ...data } = row;
  await tx.factNotification.upsert({
    where: { tenantId_notificationId: { tenantId, notificationId: row.notificationId } },
    create: { id: id ?? newId(), tenantId, ...data },
    update: data,
  });
}

// ---------------------------------------------------------------------------
// The cursor: what each projector has already seen.
// ---------------------------------------------------------------------------

export async function advanceCursor(
  tx: Tx,
  tenantId: string,
  projector: string,
  eventId: string,
  occurredAt: Date,
): Promise<void> {
  await tx.projectionCursor.upsert({
    where: { tenantId_projector: { tenantId, projector } },
    create: { id: newId(), tenantId, projector, lastEventId: eventId, lastEventAt: occurredAt, processed: 1n },
    update: { lastEventId: eventId, lastEventAt: occurredAt, processed: { increment: 1n } },
  });
}

export async function readCursors(tx: Tx) {
  return tx.projectionCursor.findMany({ orderBy: { projector: 'asc' } });
}

// ---------------------------------------------------------------------------
// Counts, for the drift check and the rebuild.
// ---------------------------------------------------------------------------

export async function countTicketFacts(tx: Tx, from?: Date, to?: Date): Promise<number> {
  return tx.factTicket.count({
    where: from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
  });
}

export async function ticketFactsForDay(tx: Tx, date: Date, batch = 1000, cursor?: string) {
  return tx.factTicket.findMany({
    where: {
      OR: [
        { createdDate: date },
        { resolvedAt: { gte: date, lt: nextDay(date) } },
        { closedAt: { gte: date, lt: nextDay(date) } },
        { firstResponseAt: { gte: date, lt: nextDay(date) } },
      ],
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: batch,
  });
}

function nextDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function recordDrift(
  tx: Tx,
  tenantId: string,
  row: { projector: string; expected: number; actual: number; driftRatio: number },
): Promise<string> {
  const id = newId();
  await tx.projectionDrift.create({ data: { id, tenantId, ...row } });
  return id;
}
