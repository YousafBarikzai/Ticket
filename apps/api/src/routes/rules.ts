import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ruleService, ruleDefinitionSchema, RULE_EVENTS, FACT_PATHS } from '@itsm/module-rules';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-06-E0 business rules.
 *
 * The routes are thin: every permission check, every validation and every audit
 * entry lives in the service, so the same rules apply whether a change arrives
 * through here, through a seed step or through the CLI (docs/architecture/08 §2).
 */
export async function ruleRoutes(app: FastifyInstance): Promise<void> {
  const idOrKey = z.object({ idOrKey: z.string().min(1).max(200) });

  app.get('/rules', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ event: z.enum(RULE_EVENTS).optional(), status: z.enum(['draft', 'published', 'archived']).optional() })
      .parse(request.query);
    return { data: await ruleService.listRules(ctx, query) };
  });

  /**
   * What a rule may read. The admin UI builds its condition picker from this, so
   * the list an author sees is the list the validator enforces.
   */
  app.get('/rules/facts', async (request) => {
    const ctx = contextOf(request);
    await ruleService.listRules(ctx, { status: 'published' });
    return { data: { facts: FACT_PATHS, events: RULE_EVENTS } };
  });

  app.get('/rules/:idOrKey', async (request) => {
    const ctx = contextOf(request);
    return ruleService.getRule(ctx, idOrKey.parse(request.params).idOrKey);
  });

  app.post('/rules', async (request, reply) => {
    const ctx = contextOf(request);
    const rule = await ruleService.createRule(ctx, ruleDefinitionSchema.strict().parse(request.body));
    reply.code(201);
    return rule;
  });

  app.patch('/rules/:idOrKey', async (request) => {
    const ctx = contextOf(request);
    const body = ruleDefinitionSchema.partial().strict().parse(request.body);
    return ruleService.updateRule(ctx, idOrKey.parse(request.params).idOrKey, body);
  });

  app.post('/rules/:idOrKey/publish', async (request) => {
    const ctx = contextOf(request);
    return ruleService.publishRule(ctx, idOrKey.parse(request.params).idOrKey);
  });

  app.post('/rules/:idOrKey/rollback', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ toVersion: z.number().int().min(1) }).strict().parse(request.body);
    return ruleService.rollbackRule(ctx, idOrKey.parse(request.params).idOrKey, body.toVersion);
  });

  app.post('/rules/:idOrKey/archive', async (request) => {
    const ctx = contextOf(request);
    return ruleService.archiveRule(ctx, idOrKey.parse(request.params).idOrKey);
  });

  /**
   * The dry run. Deliberately a POST even though it writes nothing: it is
   * expensive enough to be worth keeping out of a browser's prefetch, and the
   * sample size belongs in a body rather than a query string.
   */
  app.post('/rules/:idOrKey/test', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ sampleSize: z.number().int().min(1).max(500).optional() }).parse(request.body ?? {});
    return ruleService.testRule(ctx, idOrKey.parse(request.params).idOrKey, body.sampleSize);
  });
}
