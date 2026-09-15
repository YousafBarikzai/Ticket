import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { slaPolicyService, policySchema, calendarSchema, targetSchema } from '@itsm/module-sla';
import { contextOf } from '../plugins/context.js';

/** MOD-07-E1 SLA policy administration. */
export async function slaRoutes(app: FastifyInstance): Promise<void> {
  const idOrKey = z.object({ idOrKey: z.string().min(1).max(200) });

  app.get('/sla-policies', async (request) => {
    const ctx = contextOf(request);
    return { data: await slaPolicyService.listPolicies(ctx) };
  });

  app.post('/sla-policies', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await slaPolicyService.createPolicy(ctx, policySchema.parse(request.body));
    reply.code(201);
    return created;
  });

  app.put('/sla-policies/:idOrKey/targets', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ targets: z.array(targetSchema) }).parse(request.body);
    return { data: await slaPolicyService.updateTargets(ctx, idOrKey.parse(request.params).idOrKey, body.targets) };
  });

  app.get('/sla-calendars', async (request) => {
    const ctx = contextOf(request);
    return { data: await slaPolicyService.listCalendars(ctx) };
  });

  app.post('/sla-calendars', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await slaPolicyService.createCalendar(ctx, calendarSchema.parse(request.body));
    reply.code(201);
    return created;
  });

  app.get('/priority-matrix', async (request) => {
    const ctx = contextOf(request);
    return { data: await slaPolicyService.getPriorityMatrix(ctx) };
  });

  app.put('/priority-matrix', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ rows: z.array(z.unknown()) }).parse(request.body);
    return { data: await slaPolicyService.setPriorityMatrix(ctx, body.rows) };
  });
}
