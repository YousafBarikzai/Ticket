import { defineJob, logger, metrics, transaction } from '@itsm/platform';

/**
 * Finds articles past their review date.
 *
 * Knowledge goes stale silently — that is its characteristic failure, and it is
 * more dangerous than an article that is missing, because a confident wrong
 * answer gets followed. A review date turns "somebody should check this" into
 * something a queue can hold.
 *
 * It reports rather than retiring anything: withdrawing an article nobody has
 * looked at in six months would remove the only instructions somebody has at
 * 3am. The owner decides.
 */
defineJob<Record<string, never>>('search', 'knowledge.review.sweep', async (_payload, { ctx }) => {
  const due = await transaction(ctx, (tx) =>
    tx.knowledgeArticle.findMany({
      where: { status: 'published', reviewDueAt: { lte: new Date() } },
      orderBy: { reviewDueAt: 'asc' },
      take: 500,
    }),
  );

  metrics.observe('knowledge_articles_due_review', due.length, {});
  if (due.length > 0) {
    logger.info('articles are due for review', {
      tenantId: ctx.tenantId,
      count: due.length,
      keys: due.slice(0, 20).map((article) => article.key),
    });
  }
});
