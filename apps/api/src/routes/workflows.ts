import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { workflowService, definitionSchema, graphSchema } from '@itsm/module-workflow';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-06-E1 workflows.
 *
 * Two audiences share these routes: an administrator building a definition, and
 * an operator looking at a run that has stopped. The second is the one people
 * forget to build, and it is the one that gets used at 3am.
 */
export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(200) });
  const byId = z.object({ id: z.string().uuid() });

  app.get('/workflows', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ status: z.string().optional() }).parse(request.query);
    return { data: await workflowService.listWorkflows(ctx, query) };
  });

  app.get('/workflows/:key', async (request) => {
    const ctx = contextOf(request);
    return workflowService.getWorkflow(ctx, byKey.parse(request.params).key);
  });

  app.post('/workflows', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await workflowService.createWorkflow(ctx, definitionSchema.strict().parse(request.body));
    return reply.code(201).send(created);
  });

  app.patch('/workflows/:key', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ graph: graphSchema, changeNote: z.string().max(500).optional() }).strict().parse(request.body);
    return workflowService.saveDraft(ctx, byKey.parse(request.params).key, body.graph, body.changeNote);
  });

  /** Everything wrong with the draft, while the author can still see why they wrote it. */
  app.post('/workflows/:key/validate', async (request) => {
    const ctx = contextOf(request);
    return workflowService.validateWorkflow(ctx, byKey.parse(request.params).key);
  });

  app.post('/workflows/:key/publish', async (request) => {
    const ctx = contextOf(request);
    return workflowService.publishWorkflow(ctx, byKey.parse(request.params).key);
  });

  app.post('/workflows/:key/rollback', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ toVersion: z.number().int().min(1) }).strict().parse(request.body);
    return workflowService.rollbackWorkflow(ctx, byKey.parse(request.params).key, body.toVersion);
  });

  /** A rehearsal: the same graph, the same interpreter, nothing written. */
  app.post('/workflows/:key/test', async (request) => {
    const ctx = contextOf(request);
    const body = z
      .object({
        context: z.record(z.unknown()).default({}),
        approvalDecision: z.enum(['approved', 'rejected']).optional(),
      })
      .parse(request.body ?? {});
    return workflowService.dryRun(ctx, byKey.parse(request.params).key, body.context, {
      ...(body.approvalDecision ? { approvalDecision: body.approvalDecision } : {}),
    });
  });

  app.get('/workflow-runs', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({
        status: z.string().optional(),
        ticketId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);
    return { data: await workflowService.listRuns(ctx, query) };
  });

  app.get('/workflow-runs/:id', async (request) => {
    const ctx = contextOf(request);
    return workflowService.getRun(ctx, byId.parse(request.params).id);
  });

  app.post('/workflow-runs/:id/retry', async (request) => {
    const ctx = contextOf(request);
    return workflowService.retryRun(ctx, byId.parse(request.params).id);
  });

  app.post('/workflow-runs/:id/skip', async (request) => {
    const ctx = contextOf(request);
    // A reason is required rather than optional: somebody will ask why this
    // step did not run, and "an operator skipped it" is not an answer.
    const body = z.object({ reason: z.string().min(1).max(500) }).strict().parse(request.body);
    return workflowService.skipStep(ctx, byId.parse(request.params).id, body.reason);
  });

  app.post('/workflow-runs/:id/cancel', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().min(1).max(500) }).strict().parse(request.body);
    return workflowService.cancelRun(ctx, byId.parse(request.params).id, body.reason);
  });
}
