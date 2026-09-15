import { defineHandler, logger } from '@itsm/platform';

/**
 * An approval decision on an article.
 *
 * MOD-17 already consumes `knowledge.article.submitted`, so a tenant that wants
 * articles approved writes an approval policy for `knowledge_article` and this
 * handler carries out the answer. No approval policy means no approval request,
 * and publishing stays a permission rather than a workflow — which is the right
 * default for a team of three and the wrong one for a bank, so it is
 * configuration.
 */
defineHandler({
  consumer: 'knowledge',
  moduleId: 'MOD-09-KNOWLEDGE',
  eventType: 'approval.decided',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { subjectType: string; subjectId: string; decision: string };
    if (payload.subjectType !== 'knowledge_article') return;

    const article = await tx.knowledgeArticle.findFirst({ where: { id: payload.subjectId } });
    if (!article || article.status !== 'in_review') return;

    if (payload.decision !== 'approved') {
      // Back to the author rather than retired: a rejected article is usually
      // one sentence away from being right, and retiring it loses the draft.
      await tx.knowledgeArticle.update({ where: { id: article.id }, data: { status: 'draft' } });
      await tx.knowledgeArticleVersion.updateMany({
        where: { articleId: article.id, status: 'in_review' },
        data: { status: 'draft' },
      });
      logger.info('article sent back to its author after review', { articleId: article.id, key: article.key });
      return;
    }

    // Publication is deliberately not done here. It writes a search document,
    // moves the current version and emits an event, and all of that belongs in
    // the service that owns those invariants rather than duplicated into a
    // handler. The handler marks it ready and the publish path runs unchanged.
    await tx.knowledgeArticle.update({ where: { id: article.id }, data: { status: 'in_review' } });
    logger.info('article approved and awaiting publication', { articleId: article.id, key: article.key });
  },
});
