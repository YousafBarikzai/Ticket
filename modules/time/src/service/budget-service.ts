import { z } from 'zod';
import { events } from '@itsm/contracts';
import { ConflictError, NotFoundError, authz, logger, metrics, newId, publish, recordAudit, transaction, type TenantContext, type Tx } from '@itsm/platform';
import { PERIOD_KINDS, periodFor, thresholdsCrossed, type PeriodKind } from '../domain/cost.js';

/**
 * Budgets: a limit on spend for a scope and a period, and the lines it
 * crosses on the way up.
 *
 * Spend is kept as a running total per period so a threshold is noticed as an
 * entry crosses it, and recomputed nightly from the entries so a missed
 * decrement cannot leave the total wrong until the period ends. Same shape as
 * MOD-12's rollup: incremental for speed, rebuilt for truth.
 */

export const budgetSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(120),
  scopeType: z.enum(['tenant', 'service', 'organisation', 'team']),
  scopeId: z.string().uuid().optional(),
  periodKind: z.enum(PERIOD_KINDS),
  amount: z.number().positive().max(1_000_000_000),
  currency: z.string().length(3).toUpperCase().default('GBP'),
  warnAt: z.number().int().min(1).max(99).default(80),
  ownerId: z.string().uuid().optional(),
  isActive: z.boolean().default(true),
});
export type BudgetInput = z.input<typeof budgetSchema>;

export async function listBudgets(ctx: TenantContext) {
  authz.require(ctx, 'time.read');
  return transaction(ctx, (tx) => tx.budget.findMany({ orderBy: { name: 'asc' } }));
}

export async function createBudget(ctx: TenantContext, input: BudgetInput) {
  authz.require(ctx, 'time.manage');
  const parsed = budgetSchema.parse(input);
  if (parsed.scopeType !== 'tenant' && !parsed.scopeId) throw new ConflictError(`a ${parsed.scopeType} budget needs a scopeId`);
  return transaction(ctx, async (tx) => {
    const existing = await tx.budget.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a budget with the key ${parsed.key} already exists`);
    const row = await tx.budget.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        scopeType: parsed.scopeType,
        scopeId: parsed.scopeType === 'tenant' ? null : parsed.scopeId!,
        periodKind: parsed.periodKind,
        amount: parsed.amount,
        currency: parsed.currency,
        warnAt: parsed.warnAt,
        ownerId: parsed.ownerId ?? ctx.actor.id,
        isActive: parsed.isActive,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'budget.created', targetType: 'budget', targetId: row.id, after: parsed });
    return row;
  });
}

export async function updateBudget(ctx: TenantContext, key: string, input: Partial<BudgetInput>) {
  authz.require(ctx, 'time.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.budget.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('budget', key);
    const patch = budgetSchema.omit({ key: true }).partial().parse(input);
    const row = await tx.budget.update({
      where: { id: existing.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.warnAt !== undefined ? { warnAt: patch.warnAt } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.periodKind !== undefined ? { periodKind: patch.periodKind } : {}),
      },
    });
    await recordAudit(tx, ctx, { action: 'budget.updated', targetType: 'budget', targetId: row.id, after: patch });
    return row;
  });
}

export async function deleteBudget(ctx: TenantContext, key: string): Promise<void> {
  authz.require(ctx, 'time.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.budget.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('budget', key);
    await tx.budget.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, { action: 'budget.deleted', targetType: 'budget', targetId: existing.id, before: { key } });
  });
}

interface TicketScope {
  id: string;
  serviceId: string | null;
  orgId: string | null;
  groupId: string | null;
}

/** The active budgets a ticket's spend counts against. */
async function budgetsFor(tx: Tx, ticket: TicketScope) {
  return tx.budget.findMany({
    where: {
      isActive: true,
      OR: [
        { scopeType: 'tenant' },
        ...(ticket.serviceId ? [{ scopeType: 'service', scopeId: ticket.serviceId }] : []),
        ...(ticket.orgId ? [{ scopeType: 'organisation', scopeId: ticket.orgId }] : []),
        ...(ticket.groupId ? [{ scopeType: 'team', scopeId: ticket.groupId }] : []),
      ],
    },
  });
}

async function noteCrossings(
  ctx: TenantContext,
  tx: Tx,
  budget: { id: string; key: string; name: string; amount: unknown; currency: string; warnAt: number; ownerId: string | null },
  period: { id: string; periodStart: Date; periodEnd: Date; warnedAt: Date | null; reachedAt: Date | null },
  before: number,
  after: number,
  now: Date,
): Promise<void> {
  const amount = Number(budget.amount);
  for (const threshold of thresholdsCrossed(before, after, amount, budget.warnAt)) {
    // Once per period per line, whichever path crossed it first.
    if (threshold === 80 && period.warnedAt) continue;
    if (threshold === 100 && period.reachedAt) continue;
    await tx.budgetPeriod.update({ where: { id: period.id }, data: threshold === 80 ? { warnedAt: now } : { reachedAt: now } });
    await publish(tx, ctx, {
      definition: events.budgetThresholdReached,
      aggregateId: budget.id,
      payload: {
        budgetId: budget.id,
        key: budget.key,
        name: budget.name,
        periodStart: period.periodStart.toISOString().slice(0, 10),
        periodEnd: period.periodEnd.toISOString().slice(0, 10),
        threshold,
        spent: Math.round(after * 100) / 100,
        amount,
        currency: budget.currency,
        audience: budget.ownerId ? [{ kind: 'user', userId: budget.ownerId }] : [],
      },
    });
    metrics.increment('budget_thresholds_total', { threshold: String(threshold) });
  }
}

/**
 * Moves every matching budget's running total by a signed amount. A currency
 * mismatch is logged and skipped rather than added: pounds and euros do not
 * sum, and a budget that silently did would be worse than one that did not.
 */
export async function applySpend(
  ctx: TenantContext,
  tx: Tx,
  input: { ticket: TicketScope; cost: number; currency: string; at: Date },
  now: Date = new Date(),
): Promise<void> {
  if (input.cost === 0) return;
  for (const budget of await budgetsFor(tx, input.ticket)) {
    if (budget.currency !== input.currency) {
      logger.warn('a time entry is in a different currency from a budget it would count against; not counted', {
        budgetKey: budget.key,
        budgetCurrency: budget.currency,
        entryCurrency: input.currency,
      });
      continue;
    }
    const window = periodFor(budget.periodKind as PeriodKind, input.at);
    const period = await tx.budgetPeriod.upsert({
      where: { budgetId_periodStart: { budgetId: budget.id, periodStart: window.start } },
      create: { id: newId(), tenantId: ctx.tenantId, budgetId: budget.id, periodStart: window.start, periodEnd: window.end, spent: 0 },
      update: {},
    });
    const before = Number(period.spent);
    const after = Math.max(0, Math.round((before + input.cost) * 100) / 100);
    await tx.budgetPeriod.update({ where: { id: period.id }, data: { spent: after } });
    await noteCrossings(ctx, tx, budget, period, before, after, now);
  }
}

/** The whole truth for one budget's period, summed from the entries. */
async function sumSpend(tx: Tx, budget: { scopeType: string; scopeId: string | null; currency: string }, window: { start: Date; end: Date }): Promise<number> {
  const tickets =
    budget.scopeType === 'tenant'
      ? null
      : await tx.ticket.findMany({
          where:
            budget.scopeType === 'service'
              ? { serviceId: budget.scopeId }
              : budget.scopeType === 'organisation'
                ? { orgId: budget.scopeId }
                : { groupId: budget.scopeId },
          select: { id: true },
        });
  const result = await tx.timeEntry.aggregate({
    _sum: { cost: true },
    where: {
      deletedAt: null,
      kind: { not: 'automatic' },
      currency: budget.currency,
      loggedAt: { gte: window.start, lt: window.end },
      ...(tickets ? { ticketId: { in: tickets.map((ticket) => ticket.id) } } : {}),
    },
  });
  return Number(result._sum.cost ?? 0);
}

/** Recomputes the current period of every active budget from the entries. */
export async function recomputeAll(ctx: TenantContext, now: Date = new Date()): Promise<{ budgets: number; corrected: number }> {
  return transaction(ctx, async (tx) => {
    const budgets = await tx.budget.findMany({ where: { isActive: true } });
    let corrected = 0;
    for (const budget of budgets) {
      const window = periodFor(budget.periodKind as PeriodKind, now);
      const truth = await sumSpend(tx, budget, window);
      const period = await tx.budgetPeriod.upsert({
        where: { budgetId_periodStart: { budgetId: budget.id, periodStart: window.start } },
        create: { id: newId(), tenantId: ctx.tenantId, budgetId: budget.id, periodStart: window.start, periodEnd: window.end, spent: 0 },
        update: {},
      });
      const before = Number(period.spent);
      if (before !== truth) corrected += 1;
      await tx.budgetPeriod.update({ where: { id: period.id }, data: { spent: truth, recomputedAt: now } });
      await noteCrossings(ctx, tx, budget, period, Math.min(before, truth), truth, now);
    }
    return { budgets: budgets.length, corrected };
  });
}

export async function statusOf(ctx: TenantContext, key: string, now: Date = new Date()) {
  authz.require(ctx, 'time.read');
  return transaction(ctx, async (tx) => {
    const budget = await tx.budget.findFirst({ where: { key } });
    if (!budget) throw new NotFoundError('budget', key);
    const window = periodFor(budget.periodKind as PeriodKind, now);
    const period = await tx.budgetPeriod.findFirst({ where: { budgetId: budget.id, periodStart: window.start } });
    const spent = Number(period?.spent ?? 0);
    const amount = Number(budget.amount);
    return {
      budget,
      period: { start: window.start, end: window.end },
      spent,
      amount,
      currency: budget.currency,
      percent: amount > 0 ? Math.round((spent / amount) * 1000) / 10 : 0,
      warnedAt: period?.warnedAt ?? null,
      reachedAt: period?.reachedAt ?? null,
    };
  });
}
