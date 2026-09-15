import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { approvalService, policyDefinitionSchema, SUBJECT_TYPES } from '@itsm/module-approvals';
import { contextOf } from '../plugins/context.js';

/** MOD-17 approvals. */
export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  const byId = z.object({ id: z.string().uuid() });

  /** What is waiting on me. The first screen an approver opens. */
  app.get('/approvals', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ includeDecided: z.coerce.boolean().optional() }).parse(request.query);
    return { data: await approvalService.listMyApprovals(ctx, query) };
  });

  app.get('/approvals/:id', async (request) => {
    const ctx = contextOf(request);
    return approvalService.getApproval(ctx, byId.parse(request.params).id);
  });

  app.post('/approvals/:id/decide', async (request) => {
    const ctx = contextOf(request);
    const body = approvalService.decisionSchema.strict().parse(request.body);
    return approvalService.decide(ctx, byId.parse(request.params).id, body);
  });

  app.post('/approval-delegations', async (request, reply) => {
    const ctx = contextOf(request);
    const body = z
      .object({ fromUserId: z.string().uuid().optional() })
      .passthrough()
      .parse(request.body ?? {});
    const created = await approvalService.createDelegation(ctx, body, body.fromUserId);
    reply.code(201);
    return created;
  });

  app.get('/approval-policies', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ subjectType: z.enum(SUBJECT_TYPES).optional() }).parse(request.query);
    return { data: await approvalService.listPolicies(ctx, query) };
  });

  app.post('/approval-policies', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await approvalService.createPolicy(ctx, policyDefinitionSchema.strict().parse(request.body));
    reply.code(201);
    return created;
  });

  app.post('/approval-policies/:idOrKey/publish', async (request) => {
    const ctx = contextOf(request);
    const { idOrKey } = z.object({ idOrKey: z.string().min(1).max(200) }).parse(request.params);
    return approvalService.publishPolicy(ctx, idOrKey);
  });
}
