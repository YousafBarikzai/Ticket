import { z } from 'zod';
import {
  LimitReachedError,
  ValidationError,
  authz,
  newId,
  publish,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import {
  crossings,
  formatMicros,
  periodFor,
  problemWithLines,
  refusalMessage,
  stateFor,
  type BudgetLines,
} from '../domain/budget.js';

/**
 * What a tenant has chosen to spend on AI this month.
 *
 * Deliberately **not** one of MOD-21's meters, although it looks like one and
 * the option of folding it in was real. Three things separate them, and all
 * three matter:
 *
 *   - A plan limit is what the tenant *bought*; this is what the tenant
 *     *chose to spend*. A tenant may set its own AI cap to zero, and no
 *     tenant may set its own agent limit at all.
 *   - A meter is checked against a figure that is already true. This has to
 *     be checked before a call whose cost is not known until afterwards, so
 *     the check is on accumulated spend and one call may cross the line.
 *   - The meters are the deployment's commercial control; this is the tenant's
 *     cost control. Folding them together would mean one number with two
 *     owners, and an argument about who may move it.
 *
 * What is shared is the refusal: `LimitReachedError`, the 402 MOD-21 already
 * established, because the caller is permitted and the obstacle is commercial.
 *
 * `spent` is a **cached sum of the jobs and decisions**, recomputed from
 * `ai_job` and `ai_decision` whenever one finishes, never an accumulator. A retried job cannot inflate it, and the
 * figure can always be rebuilt from the rows beneath it (ADR-0031).
 */

export const budgetSchema = z
  .object({
    limitPence: z.number().int().min(0).max(10_000_000).nullable(),
    warnPence: z.number().int().min(0).max(10_000_000).nullable(),
  })
  .strict();
export type BudgetInput = z.input<typeof budgetSchema>;

function linesOf(row: { limitPence: number | null; warnPence: number | null }): BudgetLines {
  return { limitPence: row.limitPence, warnPence: row.warnPence };
}

/**
 * This month's row, created on first sight.
 *
 * A new month starts with no cap unless the tenant set one, and the tenant's
 * choice is carried forward from the previous month rather than forgotten —
 * a budget that silently reset to unlimited every first of the month would be
 * a budget in name only.
 */
export async function budgetFor(ctx: TenantContext, tx: Tx, at = new Date()) {
  return budgetForPeriod(ctx, tx, periodFor(at));
}

export async function budgetForPeriod(ctx: TenantContext, tx: Tx, periodKey: string) {
  const existing = await tx.aiBudget.findFirst({ where: { periodKey } });
  if (existing) return existing;

  const previous = await tx.aiBudget.findFirst({ orderBy: { periodKey: 'desc' } });
  return tx.aiBudget.upsert({
    // Upsert rather than create: two requests arriving on the first of the
    // month both find no row, and the loser of that race should read the
    // winner's rather than fail somebody's suggestion over a unique index.
    where: { tenantId_periodKey: { tenantId: ctx.tenantId, periodKey } },
    create: {
      id: newId(),
      tenantId: ctx.tenantId,
      periodKey,
      limitPence: previous?.limitPence ?? null,
      warnPence: previous?.warnPence ?? null,
    },
    update: {},
  });
}

export async function readBudget(ctx: TenantContext, at = new Date()) {
  authz.require(ctx, 'ai.read');
  return transaction(ctx, async (tx) => {
    const row = await budgetFor(ctx, tx, at);
    return {
      periodKey: row.periodKey,
      limitPence: row.limitPence,
      warnPence: row.warnPence,
      spentMicros: row.spentMicros,
      spentDisplay: formatMicros(row.spentMicros),
      state: row.state,
    };
  });
}

/** Sets this tenant's own cap and warning line. */
export async function setBudget(ctx: TenantContext, input: BudgetInput, at = new Date()) {
  authz.require(ctx, 'ai.manage');
  const parsed = budgetSchema.parse(input);
  const problem = problemWithLines(parsed);
  if (problem) throw new ValidationError(problem);

  return transaction(ctx, async (tx) => {
    const row = await budgetFor(ctx, tx, at);
    const state = stateFor(row.spentMicros, parsed);
    const updated = await tx.aiBudget.update({
      where: { id: row.id },
      data: {
        limitPence: parsed.limitPence,
        warnPence: parsed.warnPence,
        state,
        // Raising the cap clears the announcement, so the next crossing is
        // announced again rather than swallowed by a marker from last week.
        warnedAt: state === 'ok' ? null : row.warnedAt,
        blockedAt: state === 'blocked' ? row.blockedAt : null,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'ai.budget.set',
      targetType: 'ai_budget',
      targetId: updated.id,
      before: { limitPence: row.limitPence, warnPence: row.warnPence },
      after: { limitPence: updated.limitPence, warnPence: updated.warnPence },
    });
    return updated;
  });
}

/**
 * Refuses when the month's spend has reached the cap.
 *
 * On accumulated spend, not on a prediction: a completion's cost is not known
 * until it has been produced, so a tenant can end a month one call over its
 * cap. That is the honest trade, and it is the same shape as MOD-21's
 * minute-old verdict — a commercial control may be approximately right, and a
 * security control may not.
 */
export async function assertWithinBudget(ctx: TenantContext, at = new Date()): Promise<void> {
  await transaction(ctx, async (tx) => {
    const row = await budgetFor(ctx, tx, at);
    if (row.limitPence === null) return;
    if (stateFor(row.spentMicros, linesOf(row)) !== 'blocked') return;
    throw new LimitReachedError('ai_spend', refusalMessage(row.spentMicros, row.limitPence, row.periodKey));
  });
}

/**
 * Whether a decision may spend anything this month.
 *
 * The decision-path twin of `assertWithinBudget`, and deliberately not a
 * refusal: a spent budget means triage falls through to rules and the ticket
 * keeps what intake gave it. Intake is never refused for want of a decision.
 */
export async function budgetAllows(ctx: TenantContext, tx: Tx, at = new Date()): Promise<boolean> {
  const row = await budgetFor(ctx, tx, at);
  if (row.limitPence === null) return true;
  return stateFor(row.spentMicros, linesOf(row)) !== 'blocked';
}

/**
 * Recomputes the month's spend from the jobs and decisions, and announces
 * what it crossed.
 *
 * Called after a job finishes, inside that job's own transaction. The sum is
 * over an indexed range in the worker, which is where counting is allowed;
 * the request path reads the stored figure.
 */
export async function recordSpend(ctx: TenantContext, tx: Tx, periodKey: string): Promise<bigint> {
  const total = await tx.aiJob.aggregate({
    where: { periodKey, status: 'completed' },
    _sum: { costMicros: true },
  });
  // Decisions spend from the same month (ADR-0051). Every decision row counts,
  // including one that fell through to rules: a call that was charged for and
  // then thrown away was still charged for.
  const decided = await tx.aiDecision.aggregate({
    where: { periodKey },
    _sum: { costMicros: true },
  });
  const spentMicros = (total._sum.costMicros ?? 0n) + (decided._sum.costMicros ?? 0n);

  // Created if it is not there: a job can finish in a month nobody has read a
  // budget for, and a spend that landed nowhere is a spend nobody can see.
  const row = await budgetForPeriod(ctx, tx, periodKey);

  const lines = linesOf(row);
  const crossed = crossings(spentMicros, lines, { warned: row.warnedAt !== null, blocked: row.blockedAt !== null });
  const state = stateFor(spentMicros, lines);
  const now = new Date();

  await tx.aiBudget.update({
    where: { id: row.id },
    data: {
      spentMicros,
      state,
      warnedAt: crossed.includes('warned') ? now : row.warnedAt,
      blockedAt: crossed.includes('blocked') ? now : row.blockedAt,
    },
  });

  for (const threshold of crossed) {
    const limit = threshold === 'blocked' ? row.limitPence : row.warnPence;
    if (limit === null) continue;
    const owners = await tx.roleAssignment.findMany({
      where: { role: { key: 'administrator' }, user: { status: 'active', deletedAt: null } },
      select: { userId: true },
      take: 20,
    });
    await publish(tx, ctx, {
      definition: events.aiBudgetThreshold,
      aggregateId: row.id,
      payload: {
        threshold,
        periodKey,
        spentPence: Number(spentMicros / 1_000_000n),
        limitPence: limit,
        audience: owners.map((owner) => ({ kind: 'user' as const, userId: owner.userId })),
      },
    });
    await recordAudit(tx, ctx, {
      action: 'ai.budget.threshold',
      targetType: 'ai_budget',
      targetId: row.id,
      after: { threshold, periodKey, spentMicros: String(spentMicros), limitPence: limit },
    });
  }

  return spentMicros;
}
