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

interface WriteOptions {
  /**
   * An entry from a history (A4 §2.3): stored and priced and counted against
   * the budgets exactly as a live one, but not announced — it was logged
   * months ago, and a webhook or a projector told now would be told the
   * wrong thing at the wrong time. A budget line it crosses is stamped when
   * the entry was logged. Its own metric, so the live counters keep counting
   * only what people are doing now.
   */
  history?: boolean;
}

/** The single write path: price it, store it, publish it, count it. */
async function write(ctx: TenantContext, tx: Tx, input: WriteInput, options: WriteOptions = {}) {
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

  if (options.history) {
    if (cost > 0) await applySpend(ctx, tx, { ticket: input.ticket, cost, currency: rate.currency, at: input.loggedAt }, input.loggedAt);
    metrics.increment('time_entries_imported_total', { kind: input.kind });
    return row;
  }

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
// History imports (A4 §1.8, §2.3)
//
// The time people logged on tickets that were resolved before the platform
// knew about them: the shared demo's history, or a migration. Each entry is
// written through `write` above, so it is priced and moves the budgets as a
// live one would; the difference is that it names its own person and instant
// and sets nothing off — no `time.entry.logged`, so no webhook and no
// projector is told about last month now. Analytics reads imported entries
// through `reprojectFromSource` (the demo build's S8; anybody else passes
// `sources: ['time']`). No job is queued, so a tenant being built may import.
//
// The rate is today's: rates carry no history, and an entry keeps the rate it
// was written with, as every entry does.
// ---------------------------------------------------------------------------

export const importEntrySchema = z
  .object({
    ticketId: z.string().uuid(),
    taskId: z.string().uuid().optional(),
    /** Whose time it was. Always named: an imported entry is never the importer's. */
    userId: z.string().uuid(),
    activityKey: z.string().min(1).max(40),
    /** What somebody wrote down, or what a timer measured. Elapsed time is measured by the platform and never imported. */
    kind: z.enum(['manual', 'timer']).default('manual'),
    minutes: z.number().int().min(1).max(24 * 60),
    note: z.string().max(1000).optional(),
    /** When it was logged. */
    loggedAt: z.coerce.date(),
    /** When a timer ran, for a `timer` entry and only for one, as a stopped timer records it. */
    startedAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().optional(),
  })
  .strict();
export type ImportEntryInput = z.input<typeof importEntrySchema>;

/**
 * The most entries one call takes: one transaction, and — audited as a batch
 * — one audit row that can still name the ticket of every entry it brought
 * in (the trail keeps 50 entries of any list).
 */
export const IMPORT_ENTRIES_MAX = 50;

export interface ImportEntriesOptions {
  /** `row` (the default): one `time.entry.imported` audit row per entry. `batch`: one `time.entries.imported.batch` row for the call (D19). */
  audit?: 'row' | 'batch';
  /** What the batch row calls the chunk, e.g. "demo g42 time 0001-0050". */
  label?: string;
  /** The audit rows' reason, e.g. the demo build's `DEMO_BUILD_REASON`. */
  reason?: string;
}

const importEntriesOptionsSchema = z
  .object({
    audit: z.enum(['row', 'batch']).default('row'),
    label: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

type FieldProblem = { field: string; code: string; message: string };

/** What can be refused before anything is read: instants that are not dates, or have not happened, and a timer's run. */
function entryProblems(entry: z.infer<typeof importEntrySchema>, prefix: string): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const instant = (at: Date | undefined, field: string) => {
    if (at === undefined) return;
    if (Number.isNaN(at.getTime())) problems.push({ field: `${prefix}${field}`, code: 'invalid', message: 'not a date' });
    else if (at.getTime() > Date.now()) problems.push({ field: `${prefix}${field}`, code: 'in_future', message: 'must not be later than now' });
  };
  instant(entry.loggedAt, 'loggedAt');
  instant(entry.startedAt, 'startedAt');
  instant(entry.endedAt, 'endedAt');
  if (entry.kind === 'manual') {
    for (const field of ['startedAt', 'endedAt'] as const) {
      if (entry[field] !== undefined) {
        problems.push({ field: `${prefix}${field}`, code: 'not_allowed', message: 'only a timer entry records when a clock ran' });
      }
    }
  } else if (!entry.startedAt || !entry.endedAt) {
    problems.push({ field: `${prefix}${entry.startedAt ? 'endedAt' : 'startedAt'}`, code: 'required', message: 'a timer entry records when the clock started and stopped' });
  } else if (entry.endedAt <= entry.startedAt) {
    problems.push({ field: `${prefix}endedAt`, code: 'before_started', message: 'a timer stops after it starts' });
  } else if (entry.endedAt > entry.loggedAt) {
    problems.push({ field: `${prefix}endedAt`, code: 'after_logged', message: 'a timer entry is logged when the timer stops, or later' });
  }
  return problems;
}

/**
 * Imports time entries, each as it was logged, in one transaction (A4 §2.3).
 * Returns the entries in the order given.
 *
 * Each names its ticket, person, activity and instant. Refused, with nothing
 * written: an instant in the future or before its ticket was raised, a person
 * or task this tenant does not have, an activity that is unknown or the
 * platform's own, a timer without its run. Importing time logged by other
 * people needs `time.log` at tenant-wide scope.
 */
export async function importEntries(ctx: TenantContext, inputs: ImportEntryInput[], options: ImportEntriesOptions = {}) {
  const parsed = z.array(importEntrySchema).max(IMPORT_ENTRIES_MAX).parse(inputs);
  const settings = importEntriesOptionsSchema.parse(options);
  if (authz.effectiveScope(ctx, 'time.log') !== 'any') {
    throw new ForbiddenError('time.log', 'importing time logged by other people needs tenant-wide permission');
  }
  const problems = parsed.flatMap((entry, index) => entryProblems(entry, `${index}.`));
  if (problems.length > 0) throw new ValidationError('the imported time does not hold together', problems);
  if (parsed.length === 0) return [];

  return transaction(
    ctx,
    async (tx) => {
      const rows = [];
      const numbers: string[] = [];
      for (const [index, entry] of parsed.entries()) {
        const found = await tx.ticket.findFirst({
          where: { id: entry.ticketId, deletedAt: null },
          select: { id: true, number: true, groupId: true, serviceId: true, orgId: true, requesterId: true, assigneeId: true, createdAt: true },
        });
        if (!found) throw new NotFoundError('ticket', entry.ticketId);
        const { createdAt: raised, ...ticket } = found;
        const earliest = entry.startedAt ?? entry.loggedAt;
        if (earliest < raised) {
          throw new ValidationError('time cannot be spent on a ticket before it was raised', [
            { field: `${index}.${entry.startedAt ? 'startedAt' : 'loggedAt'}`, code: 'before_ticket', message: `must not be earlier than ${raised.toISOString()}` },
          ]);
        }
        const person = await tx.user.findFirst({ where: { id: entry.userId }, select: { id: true } });
        if (!person) {
          throw new ValidationError('that person is not in this directory', [{ field: `${index}.userId`, code: 'not_found', message: 'no such person' }]);
        }
        const type = await activityByKey(tx, entry.activityKey);
        if (entry.taskId) {
          const task = await tx.ticketTask.findFirst({ where: { id: entry.taskId, ticketId: ticket.id }, select: { id: true } });
          if (!task) throw new NotFoundError('task', entry.taskId);
        }

        const row = await write(
          ctx,
          tx,
          {
            ticket,
            taskId: entry.taskId ?? null,
            userId: entry.userId,
            activityTypeId: type.id,
            activityKey: type.key,
            kind: entry.kind,
            minutes: entry.minutes,
            startedAt: entry.startedAt ?? null,
            endedAt: entry.endedAt ?? null,
            note: entry.note ?? null,
            loggedAt: entry.loggedAt,
            billable: type.billable,
          },
          { history: true },
        );
        rows.push(row);
        numbers.push(ticket.number);

        if (settings.audit === 'row') {
          await recordAudit(tx, ctx, {
            action: 'time.entry.imported',
            targetType: 'time_entry',
            targetId: row.id,
            after: { ticket: ticket.number, userId: entry.userId, minutes: entry.minutes, activity: type.key, kind: entry.kind, loggedAt: entry.loggedAt.toISOString() },
            ...(settings.reason ? { reason: settings.reason } : {}),
          });
        }
      }

      if (settings.audit === 'batch') {
        // One row for the chunk, naming the ticket of every entry (A4 §2.9).
        await recordAudit(tx, ctx, {
          action: 'time.entries.imported.batch',
          targetType: 'import_batch',
          targetId: newId(),
          after: {
            label: settings.label ?? null,
            count: rows.length,
            minutes: parsed.reduce((sum, entry) => sum + entry.minutes, 0),
            first: numbers[0]!,
            last: numbers.at(-1)!,
            tickets: numbers,
          },
          ...(settings.reason ? { reason: settings.reason } : {}),
        });
      }
      return rows;
    },
    // Fifty entries, each priced and counted against its budgets, are a few
    // hundred statements; one keeps the default every other write has.
    parsed.length > 1 ? { timeout: 60_000 } : {},
  );
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

