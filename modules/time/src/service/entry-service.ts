import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { TIMER_CAP_MINUTES, costOf, minutesBetween, type EntryKind } from '../domain/cost.js';
import { AUTOMATIC_ACTIVITY_KEY } from '../seed/defaults.js';
import { rateFor } from './activity-service.js';
import { applySpend } from './budget-service.js';

/**
 * Time entries and the timer.
 *
 * Every write goes through `write`, which resolves the rate, prices the
 * entry, publishes the event and moves the budgets — so a manual entry, a
 * stopped timer and an automatic span are priced and counted identically,
 * apart from the automatic kind costing nothing.
 */

export const logEntrySchema = z.object({
  ticketId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  activityKey: z.string().min(1).max(40),
  minutes: z.number().int().min(1).max(24 * 60),
  note: z.string().max(1000).optional(),
  /** Defaults to now. A person logging Tuesday's work on Wednesday says so here. */
  loggedAt: z.string().datetime().optional(),
  /** Somebody else's time, for a lead logging on behalf; needs team or any scope. */
  userId: z.string().uuid().optional(),
});
export type LogEntryInput = z.input<typeof logEntrySchema>;

export const updateEntrySchema = z.object({
  minutes: z.number().int().min(1).max(24 * 60).optional(),
  note: z.string().max(1000).nullable().optional(),
  activityKey: z.string().min(1).max(40).optional(),
});

export const startTimerSchema = z.object({
  ticketId: z.string().uuid(),
  activityKey: z.string().min(1).max(40),
  note: z.string().max(1000).optional(),
});

interface TicketFacts {
  id: string;
  number: string;
  groupId: string | null;
  serviceId: string | null;
  orgId: string | null;
  requesterId: string | null;
  assigneeId: string | null;
}

async function loadTicket(tx: Tx, ctx: TenantContext, ticketId: string): Promise<TicketFacts> {
  const ticket = await tx.ticket.findFirst({
    where: { id: ticketId, deletedAt: null },
    select: { id: true, number: true, groupId: true, serviceId: true, orgId: true, requesterId: true, assigneeId: true },
  });
  if (!ticket) throw new NotFoundError('ticket', ticketId);
  authz.requireVisible(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket }, 'ticket');
  return ticket;
}

/** Whether the caller may record time as `userId`: their own, or their team's at team scope, or anyone's at any. */
function requireMayLogFor(ctx: TenantContext, userId: string, ticket: TicketFacts): void {
  const scope = authz.effectiveScope(ctx, 'time.log');
  if (!scope) throw new ForbiddenError('time.log');
  if (userId === ctx.actor.id) return;
  if (scope === 'any') return;
  if (scope === 'team' && ticket.groupId && ctx.teamIds.includes(ticket.groupId)) return;
  throw new ForbiddenError('you can only log your own time here');
}

async function activityByKey(tx: Tx, key: string, allowSystem = false) {
  const type = await tx.activityType.findFirst({ where: { key, isActive: true } });
  if (!type) throw new NotFoundError('activity type', key);
  if (type.isSystem && !allowSystem) throw new ValidationError(`${key} is recorded by the platform and cannot be chosen`);
  return type;
}

interface WriteInput {
  ticket: TicketFacts;
  taskId: string | null;
  userId: string;
  activityTypeId: string;
  activityKey: string;
  kind: EntryKind;
  minutes: number;
  startedAt: Date | null;
  endedAt: Date | null;
  note: string | null;
  loggedAt: Date;
  billable: boolean;
}

/** The single write path: price it, store it, publish it, count it. */
async function write(ctx: TenantContext, tx: Tx, input: WriteInput) {
  // Elapsed time is never effort and never money.
  const rate = input.kind === 'automatic' ? { ratePerHour: 0, currency: 'GBP' } : await rateFor(tx, input.activityTypeId, input.ticket.groupId);
  const cost = input.kind === 'automatic' ? 0 : costOf(input.minutes, rate.ratePerHour);

  const row = await tx.timeEntry.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      ticketId: input.ticket.id,
      taskId: input.taskId,
      userId: input.userId,
      activityTypeId: input.activityTypeId,
      kind: input.kind,
      minutes: input.minutes,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      note: input.note,
      ratePerHour: rate.ratePerHour,
      currency: rate.currency,
      cost,
      billable: input.kind === 'automatic' ? false : input.billable,
      loggedAt: input.loggedAt,
      createdBy: ctx.actor.id,
    },
  });

  await publish(tx, ctx, {
    definition: events.timeEntryLogged,
    aggregateId: row.id,
    payload: {
      entryId: row.id,
      ticketId: input.ticket.id,
      taskId: input.taskId,
      userId: input.userId,
      activityKey: input.activityKey,
      kind: input.kind,
      minutes: input.minutes,
      cost,
      currency: rate.currency,
      billable: row.billable,
    },
  });

  if (cost > 0) await applySpend(ctx, tx, { ticket: input.ticket, cost, currency: rate.currency, at: input.loggedAt });

  metrics.increment('time_entries_total', { kind: input.kind });
  metrics.observe('time_entry_minutes', input.minutes, { kind: input.kind });
  return row;
}

export async function logEntry(ctx: TenantContext, input: LogEntryInput) {
  const parsed = logEntrySchema.parse(input);
  return transaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, ctx, parsed.ticketId);
    const userId = parsed.userId ?? ctx.actor.id;
    if (!userId) throw new ForbiddenError('time needs a person to belong to');
    requireMayLogFor(ctx, userId, ticket);
    const type = await activityByKey(tx, parsed.activityKey);
    if (parsed.taskId) {
      const task = await tx.ticketTask.findFirst({ where: { id: parsed.taskId, ticketId: ticket.id }, select: { id: true } });
      if (!task) throw new NotFoundError('task', parsed.taskId);
    }

    const row = await write(ctx, tx, {
      ticket,
      taskId: parsed.taskId ?? null,
      userId,
      activityTypeId: type.id,
      activityKey: type.key,
      kind: 'manual',
      minutes: parsed.minutes,
      startedAt: null,
      endedAt: null,
      note: parsed.note ?? null,
      loggedAt: parsed.loggedAt ? new Date(parsed.loggedAt) : new Date(),
      billable: type.billable,
    });
    await recordAudit(tx, ctx, { action: 'time.entry.logged', targetType: 'time_entry', targetId: row.id, after: { ticket: ticket.number, minutes: parsed.minutes, activity: type.key } });
    return row;
  });
}

async function loadEntry(tx: Tx, ctx: TenantContext, id: string) {
  const entry = await tx.timeEntry.findFirst({ where: { id, deletedAt: null } });
  if (!entry) throw new NotFoundError('time entry', id);
  const ticket = await loadTicket(tx, ctx, entry.ticketId);
  requireMayLogFor(ctx, entry.userId, ticket);
  if (entry.kind === 'automatic') throw new ValidationError('elapsed time is measured, not edited');
  return { entry, ticket };
}

/**
 * Changes minutes, note or activity. Re-priced at today's rate for the new
 * minutes: an edit is a new statement of what the work was, and it is priced
 * the way a new entry would be.
 */
export async function updateEntry(ctx: TenantContext, id: string, input: z.input<typeof updateEntrySchema>) {
  const patch = updateEntrySchema.parse(input);
  return transaction(ctx, async (tx) => {
    const { entry, ticket } = await loadEntry(tx, ctx, id);
    const type = patch.activityKey ? await activityByKey(tx, patch.activityKey) : await tx.activityType.findFirst({ where: { id: entry.activityTypeId } });
    if (!type) throw new NotFoundError('activity type', entry.activityTypeId);
    const minutes = patch.minutes ?? entry.minutes;
    const rate = await rateFor(tx, type.id, ticket.groupId);
    const cost = costOf(minutes, rate.ratePerHour);
    const previousCost = Number(entry.cost);

    const row = await tx.timeEntry.update({
      where: { id },
      data: {
        minutes,
        activityTypeId: type.id,
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ratePerHour: rate.ratePerHour,
        currency: rate.currency,
        cost,
        billable: type.billable,
      },
    });

    if (cost !== previousCost) {
      await applySpend(ctx, tx, { ticket, cost: cost - previousCost, currency: rate.currency, at: entry.loggedAt });
    }
    await recordAudit(tx, ctx, { action: 'time.entry.updated', targetType: 'time_entry', targetId: id, before: { minutes: entry.minutes, cost: previousCost }, after: { minutes, cost } });
    return row;
  });
}

export async function deleteEntry(ctx: TenantContext, id: string): Promise<void> {
  await transaction(ctx, async (tx) => {
    const { entry, ticket } = await loadEntry(tx, ctx, id);
    await tx.timeEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    const cost = Number(entry.cost);
    if (cost > 0) await applySpend(ctx, tx, { ticket, cost: -cost, currency: entry.currency, at: entry.loggedAt });
    await publish(tx, ctx, {
      definition: events.timeEntryDeleted,
      aggregateId: id,
      payload: { entryId: id, ticketId: entry.ticketId, userId: entry.userId, minutes: entry.minutes, cost },
    });
    await recordAudit(tx, ctx, { action: 'time.entry.deleted', targetType: 'time_entry', targetId: id, before: { minutes: entry.minutes, cost } });
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Entries on a ticket, with their activity, for the ticket's time tab. */
export async function listForTicket(ctx: TenantContext, ticketId: string) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, ctx, ticketId);
    const scope = authz.effectiveScope(ctx, 'time.read');
    if (!scope) throw new ForbiddenError('time.read');
    // Everything on the ticket at any scope, or at team scope when the ticket
    // is one of the reader's teams'; otherwise only the reader's own entries.
    const wholeTicket = scope === 'any' || (scope === 'team' && ticket.groupId !== null && ctx.teamIds.includes(ticket.groupId));
    const where = wholeTicket ? { ticketId: ticket.id } : { ticketId: ticket.id, userId: ctx.actor.id ?? '' };
    const rows = await tx.timeEntry.findMany({ where: { ...where, deletedAt: null }, orderBy: { loggedAt: 'desc' } });
    const types = new Map((await tx.activityType.findMany({})).map((type) => [type.id, type]));
    return rows.map((row) => ({ ...row, activityKey: types.get(row.activityTypeId)?.key ?? null, activityName: types.get(row.activityTypeId)?.name ?? null }));
  });
}

/** Totals for a ticket: logged effort, cost, and elapsed working time, kept apart. */
export async function summaryForTicket(ctx: TenantContext, ticketId: string) {
  const entries = await listForTicket(ctx, ticketId);
  const effort = entries.filter((entry) => entry.kind !== 'automatic');
  const elapsed = entries.filter((entry) => entry.kind === 'automatic');
  return {
    ticketId,
    loggedMinutes: effort.reduce((sum, entry) => sum + entry.minutes, 0),
    cost: Math.round(effort.reduce((sum, entry) => sum + Number(entry.cost), 0) * 100) / 100,
    currency: effort[0]?.currency ?? null,
    elapsedMinutes: elapsed.reduce((sum, entry) => sum + entry.minutes, 0),
    entries: entries.length,
  };
}

export async function listMine(ctx: TenantContext, options: { from?: Date; to?: Date; limit?: number } = {}) {
  authz.require(ctx, 'time.read');
  return transaction(ctx, (tx) =>
    tx.timeEntry.findMany({
      where: {
        userId: ctx.actor.id ?? '',
        deletedAt: null,
        ...(options.from || options.to ? { loggedAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lt: options.to } : {}) } } : {}),
      },
      orderBy: { loggedAt: 'desc' },
      take: options.limit ?? 100,
    }),
  );
}

// ---------------------------------------------------------------------------
// The timer
// ---------------------------------------------------------------------------

export async function currentTimer(ctx: TenantContext) {
  authz.require(ctx, 'time.log');
  return transaction(ctx, (tx) => tx.runningTimer.findFirst({ where: { userId: ctx.actor.id ?? '' } }));
}

export async function startTimer(ctx: TenantContext, input: z.input<typeof startTimerSchema>) {
  authz.require(ctx, 'time.log');
  const parsed = startTimerSchema.parse(input);
  if (!ctx.actor.id) throw new ForbiddenError('a timer needs a person');
  return transaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, ctx, parsed.ticketId);
    const type = await activityByKey(tx, parsed.activityKey);
    const running = await tx.runningTimer.findFirst({ where: { userId: ctx.actor.id! } });
    if (running) throw new ConflictError('a timer is already running; stop it first', { ticketId: running.ticketId, startedAt: running.startedAt });
    return tx.runningTimer.create({
      data: { id: newId(), tenantId: ctx.tenantId, userId: ctx.actor.id!, ticketId: ticket.id, activityTypeId: type.id, note: parsed.note ?? null },
    });
  });
}

/** Stops the timer and writes the entry. Capped, and the cap is written down. */
export async function stopTimer(ctx: TenantContext, now: Date = new Date()) {
  authz.require(ctx, 'time.log');
  if (!ctx.actor.id) throw new ForbiddenError('a timer needs a person');
  return transaction(ctx, async (tx) => {
    const running = await tx.runningTimer.findFirst({ where: { userId: ctx.actor.id! } });
    if (!running) throw new NotFoundError('running timer', ctx.actor.id!);
    const ticket = await loadTicket(tx, ctx, running.ticketId);
    const type = await tx.activityType.findFirst({ where: { id: running.activityTypeId } });
    if (!type) throw new NotFoundError('activity type', running.activityTypeId);

    const measured = minutesBetween(running.startedAt, now);
    const capped = measured > TIMER_CAP_MINUTES;
    const minutes = capped ? TIMER_CAP_MINUTES : measured;
    const note = capped ? `${running.note ? `${running.note} — ` : ''}timer ran ${measured} minutes; capped at ${TIMER_CAP_MINUTES}` : running.note;

    const row = await write(ctx, tx, {
      ticket,
      taskId: null,
      userId: ctx.actor.id!,
      activityTypeId: type.id,
      activityKey: type.key,
      kind: 'timer',
      minutes,
      startedAt: running.startedAt,
      endedAt: now,
      note,
      loggedAt: now,
      billable: type.billable,
    });
    await tx.runningTimer.delete({ where: { id: running.id } });
    await recordAudit(tx, ctx, { action: 'time.timer.stopped', targetType: 'time_entry', targetId: row.id, after: { ticket: ticket.number, minutes, capped } });
    return row;
  });
}

// ---------------------------------------------------------------------------
// The automatic kind
// ---------------------------------------------------------------------------

/**
 * Records how long a ticket sat in a working state, against whoever it was
 * assigned to when it left. Nothing is priced and nothing is billable: this
 * is a measurement, and the kind on the row says so.
 */
export async function recordElapsed(
  ctx: TenantContext,
  tx: Tx,
  input: { ticketId: string; from: Date; to: Date },
): Promise<{ recorded: boolean; minutes: number }> {
  const ticket = await tx.ticket.findFirst({
    where: { id: input.ticketId },
    select: { id: true, number: true, groupId: true, serviceId: true, orgId: true, requesterId: true, assigneeId: true },
  });
  if (!ticket?.assigneeId) return { recorded: false, minutes: 0 };
  const minutes = minutesBetween(input.from, input.to);
  if (minutes === 0) return { recorded: false, minutes: 0 };
  const type = await tx.activityType.findFirst({ where: { key: AUTOMATIC_ACTIVITY_KEY } });
  if (!type) return { recorded: false, minutes };

  await write(ctx, tx, {
    ticket,
    taskId: null,
    userId: ticket.assigneeId,
    activityTypeId: type.id,
    activityKey: type.key,
    kind: 'automatic',
    minutes,
    startedAt: input.from,
    endedAt: input.to,
    note: null,
    loggedAt: input.to,
    billable: false,
  });
  return { recorded: true, minutes };
}

