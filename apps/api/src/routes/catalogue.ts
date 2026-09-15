import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  catalogueService,
  formService,
  serviceSchema,
  requestTypeSchema,
  createFormSchema,
} from '@itsm/module-catalogue';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-05 catalogue and MOD-02 forms.
 *
 * The requester's three routes come first because they are the ones under load:
 * browse what I may raise, open one, submit it. Everything after them is
 * administration.
 */
export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(200) });

  app.get('/catalogue', async (request) => {
    const ctx = contextOf(request);
    return { data: await catalogueService.browse(ctx) };
  });

  app.get('/catalogue/:key', async (request) => {
    const ctx = contextOf(request);
    return catalogueService.openRequest(ctx, byKey.parse(request.params).key);
  });

  app.post('/catalogue/:key/submit', async (request, reply) => {
    const ctx = contextOf(request);
    const body = z.object({ answers: z.record(z.unknown()).default({}) }).parse(request.body ?? {});
    const result = await catalogueService.submitRequest(ctx, byKey.parse(request.params).key, body.answers as never);
    reply.code(201);
    return result;
  });

  // --- administration ------------------------------------------------------

  app.post('/services', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await catalogueService.createService(ctx, serviceSchema.parse(request.body));
    reply.code(201);
    return created;
  });

  app.post('/request-types', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await catalogueService.createRequestType(ctx, requestTypeSchema.parse(request.body));
    reply.code(201);
    return created;
  });

  app.post('/request-types/:key/publish', async (request) => {
    const ctx = contextOf(request);
    return catalogueService.publishRequestType(ctx, byKey.parse(request.params).key);
  });

  app.get('/forms', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ status: z.enum(['draft', 'published']).optional() }).parse(request.query);
    return { data: await formService.listForms(ctx, query) };
  });

  app.post('/forms', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await formService.createForm(ctx, createFormSchema.parse(request.body));
    reply.code(201);
    return created;
  });

  app.post('/forms/:key/publish', async (request) => {
    const ctx = contextOf(request);
    return formService.publishForm(ctx, byKey.parse(request.params).key);
  });
}
