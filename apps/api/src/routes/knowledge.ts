import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { articleService, articleSchema, draftSchema } from '@itsm/module-knowledge';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-09 knowledge.
 *
 * Reading comes first, because that is what the routes are for: an article is
 * written once and read a thousand times. Every read goes through the service's
 * audience check rather than a query filter here, so a reader who guesses a key
 * gets the same 404 as one who was never shown it.
 */
export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(200) });

  app.get('/knowledge', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({
        status: z.string().optional(),
        category: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);
    return {
      data: await articleService.listArticles(ctx, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { categoryKey: query.category } : {}),
        limit: query.limit,
      }),
    };
  });

  app.get('/knowledge/:key', async (request) => {
    const ctx = contextOf(request);
    return articleService.readArticle(ctx, byKey.parse(request.params).key);
  });

  app.get('/knowledge/:key/history', async (request) => {
    const ctx = contextOf(request);
    return { data: await articleService.articleHistory(ctx, byKey.parse(request.params).key) };
  });

  app.post('/knowledge', async (request, reply) => {
    const ctx = contextOf(request);
    const article = await articleService.createArticle(ctx, articleSchema.strict().parse(request.body));
    return reply.code(201).send(article);
  });

  app.patch('/knowledge/:key', async (request) => {
    const ctx = contextOf(request);
    return articleService.saveDraft(ctx, byKey.parse(request.params).key, draftSchema.parse(request.body ?? {}));
  });

  app.post('/knowledge/:key/submit', async (request) => {
    const ctx = contextOf(request);
    return articleService.submitForReview(ctx, byKey.parse(request.params).key);
  });

  app.post('/knowledge/:key/publish', async (request) => {
    const ctx = contextOf(request);
    return articleService.publishArticle(ctx, byKey.parse(request.params).key);
  });

  app.post('/knowledge/:key/rollback', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ toVersion: z.number().int().min(1) }).strict().parse(request.body);
    return articleService.rollbackArticle(ctx, byKey.parse(request.params).key, body.toVersion);
  });

  app.post('/knowledge/:key/retire', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().max(500).optional() }).parse(request.body ?? {});
    return articleService.retireArticle(ctx, byKey.parse(request.params).key, body.reason);
  });

  app.post('/knowledge/:key/feedback', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ helpful: z.boolean(), comment: z.string().max(1000).optional() }).strict().parse(request.body);
    return articleService.recordFeedback(ctx, byKey.parse(request.params).key, body.helpful, body.comment);
  });

  app.post('/knowledge/:key/link', async (request) => {
    const ctx = contextOf(request);
    const body = z
      .object({ ticketId: z.string().uuid(), relation: z.enum(['referenced', 'resolved']).default('referenced') })
      .strict().parse(request.body);
    return articleService.linkToTicket(ctx, byKey.parse(request.params).key, body.ticketId, body.relation);
  });
}
