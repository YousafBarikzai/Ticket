import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  problemService,
  knownErrorService,
  createProblemSchema,
  linkSchema,
  transitionSchema,
  publishSchema,
} from '@itsm/module-problem';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-08-E2 problems and known errors.
 *
 * `/known-errors` is the route that earns the module its place: it is what an
 * agent searches before spending an hour on something somebody already solved.
 */
export async function problemRoutes(app: FastifyInstance): Promise<void> {
  const byNumber = z.object({ number: z.string().min(1).max(40) });

  app.get('/problems', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ status: z.string().optional(), serviceId: z.string().uuid().optional(), open: z.coerce.boolean().optional() })
      .parse(request.query);
    const problems = await problemService.listProblems(ctx, query);
    return {
      data: problems.map((problem) => ({
        number: problem.number,
        title: problem.title,
        status: problem.status,
        priority: problem.priority,
        raisedFrom: problem.raisedFrom,
        ownerId: problem.ownerId,
        // The number that makes a problem arguable against feature work.
        ticketCount: problem._count.tickets,
        hasWorkaround: problem.knownError?.status === 'published',
        createdAt: problem.createdAt.toISOString(),
        resolvedAt: problem.resolvedAt?.toISOString() ?? null,
      })),
    };
  });

  app.get('/problems/:number', async (request) => {
    const ctx = contextOf(request);
    const { problem, knownError, links } = await problemService.getProblem(ctx, byNumber.parse(request.params).number);
    return {
      number: problem.number,
      title: problem.title,
      description: problem.description,
      status: problem.status,
      priority: problem.priority,
      raisedFrom: problem.raisedFrom,
      majorIncidentId: problem.majorIncidentId,
      serviceId: problem.serviceId,
      categoryId: problem.categoryId,
      ownerId: problem.ownerId,
      rootCause: problem.rootCause,
      createdAt: problem.createdAt.toISOString(),
      resolvedAt: problem.resolvedAt?.toISOString() ?? null,
      closedAt: problem.closedAt?.toISOString() ?? null,
      knownError: knownError
        ? {
            symptom: knownError.symptom,
            workaround: knownError.workaround,
            articleKey: knownError.articleKey,
            status: knownError.status,
            publishedAt: knownError.publishedAt.toISOString(),
            retiredAt: knownError.retiredAt?.toISOString() ?? null,
            retiredReason: knownError.retiredReason,
            // Whether an agent should be acting on it, which is not the same as
            // whether a row exists.
            live: knownError.status === 'published' && problemService.workaroundLive(problem.status),
          }
        : null,
      tickets: {
        count: links.length,
        workaroundApplied: links.filter((link) => link.workaroundApplied).length,
        ids: links.slice(0, 200).map((link) => link.ticketId),
      },
    };
  });

  app.post('/problems', async (request, reply) => {
    const ctx = contextOf(request);
    const problem = await problemService.createProblem(ctx, createProblemSchema.parse(request.body));
    return reply.code(201).send({ number: problem.number, title: problem.title, status: problem.status });
  });

  app.post('/problems/:number/tickets', async (request) => {
    const ctx = contextOf(request);
    return problemService.linkTickets(ctx, byNumber.parse(request.params).number, linkSchema.parse(request.body));
  });

  app.delete('/problems/:number/tickets/:ticketId', async (request, reply) => {
    const ctx = contextOf(request);
    const params = z.object({ number: z.string().min(1).max(40), ticketId: z.string().uuid() }).parse(request.params);
    await problemService.unlinkTicket(ctx, params.number, params.ticketId);
    reply.status(204);
  });

  app.post('/problems/:number/transition', async (request) => {
    const ctx = contextOf(request);
    const problem = await problemService.transition(
      ctx,
      byNumber.parse(request.params).number,
      transitionSchema.parse(request.body),
    );
    return { number: problem.number, status: problem.status, rootCause: problem.rootCause };
  });

  // ---- known errors ------------------------------------------------------

  /** What an agent searches before spending an hour on a solved problem. */
  app.get('/known-errors', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ q: z.string().max(200).optional() }).parse(request.query);
    const rows = await knownErrorService.listKnownErrors(ctx, query.q);
    return {
      data: rows.map((row) => ({
        problemNumber: row.problem.number,
        problemTitle: row.problem.title,
        problemStatus: row.problem.status,
        priority: row.problem.priority,
        symptom: row.symptom,
        workaround: row.workaround,
        articleKey: row.articleKey,
        publishedAt: row.publishedAt.toISOString(),
      })),
    };
  });

  app.put('/problems/:number/known-error', async (request) => {
    const ctx = contextOf(request);
    const knownError = await knownErrorService.publishKnownError(
      ctx,
      byNumber.parse(request.params).number,
      publishSchema.parse(request.body),
    );
    return { symptom: knownError.symptom, status: knownError.status, publishedAt: knownError.publishedAt.toISOString() };
  });

  app.delete('/problems/:number/known-error', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().min(1).max(1000) }).parse(request.body ?? {});
    return knownErrorService.retireKnownError(ctx, byNumber.parse(request.params).number, body.reason);
  });
}
