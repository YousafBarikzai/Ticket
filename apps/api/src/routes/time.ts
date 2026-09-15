import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activityService, budgetService, entryService } from '@itsm/module-time';
import { contextOf } from '../plugins/context.js';

/** MOD-19 time entries, the timer, activity types and rates, budgets. */
export async function timeRoutes(app: FastifyInstance): Promise<void> {
  const byId = z.object({ id: z.string().uuid() });
  const byKey = z.object({ key: z.string().min(1).max(64) });

  const entry = (row: { id: string; ticketId: string; taskId: string | null; userId: string; kind: string; minutes: number; note: string | null; ratePerHour: unknown; currency: string; cost: unknown; billable: boolean; loggedAt: Date; startedAt: Date | null; endedAt: Date | null; activityKey?: string | null; activityName?: string | null }) => ({
    id: row.id,
    ticketId: row.ticketId,
    taskId: row.taskId,
    userId: row.userId,
    kind: row.kind,
    minutes: row.minutes,
    note: row.note,
    ratePerHour: Number(row.ratePerHour),
    currency: row.currency,
    cost: Number(row.cost),
    billable: row.billable,
    loggedAt: row.loggedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    ...(row.activityKey !== undefined ? { activityKey: row.activityKey, activityName: row.activityName } : {}),
  });

  // ---- Entries --------------------------------------------------------------

  app.get('/tickets/:id/time', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const [rows, summary] = await Promise.all([entryService.listForTicket(ctx, id), entryService.summaryForTicket(ctx, id)]);
    return { data: rows.map(entry), summary };
  });

  app.post('/time-entries', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await entryService.logEntry(ctx, request.body as never);
    reply.status(201);
    return entry(row);
  });

  app.patch('/time-entries/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return entry(await entryService.updateEntry(ctx, id, request.body as never));
  });

  app.delete('/time-entries/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await entryService.deleteEntry(ctx, id);
    reply.status(204);
    return null;
  });

  app.get('/time/mine', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    const rows = await entryService.listMine(ctx, { ...(query.from ? { from: new Date(query.from) } : {}), ...(query.to ? { to: new Date(query.to) } : {}), limit: query.limit });
    return { data: rows.map(entry) };
  });

  // ---- The timer ------------------------------------------------------------

  app.get('/time/timer', async (request) => {
    const ctx = contextOf(request);
    const running = await entryService.currentTimer(ctx);
    return { running: running ? { ticketId: running.ticketId, activityTypeId: running.activityTypeId, note: running.note, startedAt: running.startedAt.toISOString() } : null };
  });

  app.post('/time/timer/start', async (request, reply) => {
    const ctx = contextOf(request);
    const running = await entryService.startTimer(ctx, request.body as never);
    reply.status(201);
    return { ticketId: running.ticketId, startedAt: running.startedAt.toISOString() };
  });

  app.post('/time/timer/stop', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await entryService.stopTimer(ctx);
    reply.status(201);
    return entry(row);
  });

  // ---- Activity types and rates ---------------------------------------------

  app.get('/activity-types', async (request) => {
    const ctx = contextOf(request);
    const rows = await activityService.listActivityTypes(ctx);
    return {
      data: rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        billable: row.billable,
        ratePerHour: Number(row.ratePerHour),
        currency: row.currency,
        isSystem: row.isSystem,
        isActive: row.isActive,
        teamRates: row.rates.map((rate) => ({ teamId: rate.teamId, ratePerHour: Number(rate.ratePerHour), currency: rate.currency })),
      })),
    };
  });

  app.post('/activity-types', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await activityService.createActivityType(ctx, request.body as never);
    reply.status(201);
    return { id: row.id, key: row.key, name: row.name, ratePerHour: Number(row.ratePerHour), currency: row.currency };
  });

  app.patch('/activity-types/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const row = await activityService.updateActivityType(ctx, key, request.body as never);
    return { id: row.id, key: row.key, name: row.name, ratePerHour: Number(row.ratePerHour), currency: row.currency, isActive: row.isActive };
  });

  app.put('/activity-types/:key/rates', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const row = await activityService.setTeamRate(ctx, key, request.body as never);
    return { teamId: row.teamId, ratePerHour: Number(row.ratePerHour), currency: row.currency };
  });

  app.delete('/activity-types/:key/rates/:teamId', async (request, reply) => {
    const ctx = contextOf(request);
    const { key, teamId } = z.object({ key: z.string().min(1).max(64), teamId: z.string().uuid() }).parse(request.params);
    await activityService.removeTeamRate(ctx, key, teamId);
    reply.status(204);
    return null;
  });

  // ---- Budgets --------------------------------------------------------------

  const budget = (row: { id: string; key: string; name: string; scopeType: string; scopeId: string | null; periodKind: string; amount: unknown; currency: string; warnAt: number; ownerId: string | null; isActive: boolean }) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    periodKind: row.periodKind,
    amount: Number(row.amount),
    currency: row.currency,
    warnAt: row.warnAt,
    ownerId: row.ownerId,
    isActive: row.isActive,
  });

  app.get('/budgets', async (request) => {
    const ctx = contextOf(request);
    return { data: (await budgetService.listBudgets(ctx)).map(budget) };
  });

  app.post('/budgets', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await budgetService.createBudget(ctx, request.body as never);
    reply.status(201);
    return budget(row);
  });

  app.patch('/budgets/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return budget(await budgetService.updateBudget(ctx, key, request.body as never));
  });

  app.delete('/budgets/:key', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    await budgetService.deleteBudget(ctx, key);
    reply.status(204);
    return null;
  });

  app.get('/budgets/:key/status', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const status = await budgetService.statusOf(ctx, key);
    return {
      budget: budget(status.budget),
      period: { start: status.period.start.toISOString().slice(0, 10), end: status.period.end.toISOString().slice(0, 10) },
      spent: status.spent,
      amount: status.amount,
      currency: status.currency,
      percent: status.percent,
      warnedAt: status.warnedAt?.toISOString() ?? null,
      reachedAt: status.reachedAt?.toISOString() ?? null,
    };
  });
}
