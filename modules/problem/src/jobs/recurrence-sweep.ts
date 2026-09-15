import { defineJob, getSetting, logger, metrics, transaction, type TenantContext } from '@itsm/platform';
import { RECURRENCE_THRESHOLD } from '../domain/lifecycle.js';

/**
 * Notices the same thing coming back.
 *
 * Suggests; never creates. A platform that raised problems by itself would
 * produce a backlog of noise that buries the three somebody actually cares
 * about, and the costs are asymmetric: a wrong suggestion costs a glance, a
 * wrong problem is a permanent list entry nobody dares delete.
 *
 * (The one exception is a severe major incident's review, which raises exactly
 * one problem — see `handlers/`. That exception is safe precisely because it is
 * bounded; this is not.)
 *
 * Categories that already have an open problem are excluded, because the
 * suggestion an agent most resents is the one for work that is already on the
 * board.
 */
export interface Recurrence {
  categoryId: string;
  tickets: number;
}

export async function findRecurrences(ctx: TenantContext, now: Date = new Date()): Promise<Recurrence[]> {
  const configured = await getSetting<{ tickets: number; withinDays: number }>(ctx, 'problem.recurrenceThreshold');
  const threshold = configured ?? RECURRENCE_THRESHOLD;
  const since = new Date(now.getTime() - threshold.withinDays * 86_400_000);

  return transaction(ctx, async (tx) => {
    const grouped = await tx.ticket.groupBy({
      by: ['categoryId'],
      where: { categoryId: { not: null }, createdAt: { gte: since }, deletedAt: null },
      _count: { _all: true },
      having: { categoryId: { _count: { gte: threshold.tickets } } },
    });

    const open = await tx.problem.findMany({
      where: { status: { not: 'closed' }, categoryId: { not: null } },
      select: { categoryId: true },
    });
    const covered = new Set(open.map((problem) => problem.categoryId));

    return grouped
      .filter((row) => row.categoryId && !covered.has(row.categoryId))
      .map((row) => ({ categoryId: row.categoryId as string, tickets: row._count._all }))
      .sort((a, b) => b.tickets - a.tickets);
  });
}

defineJob<Record<string, never>>('analytics', 'problem.recurrence.sweep', async (_payload, { ctx }) => {
  const recurrences = await findRecurrences(ctx);
  metrics.observe('problem_recurrences_suggested', recurrences.length, {});
  if (recurrences.length === 0) return;

  logger.info('categories are recurring often enough to be worth a problem', {
    tenantId: ctx.tenantId,
    count: recurrences.length,
    top: recurrences.slice(0, 10),
  });
});
