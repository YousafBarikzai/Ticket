import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  catalogueService,
  formService,
  serviceSchema,
  serviceUpdateSchema,
  requestTypeUpdateSchema,
  requestTypeSchema,
  createFormSchema,
  updateFormSchema,
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

  /**
   * The administrator's view of the catalogue, drafts included.
   *
   * `GET /catalogue` is the requester's: published, entitled, shaped for a
   * portal card. These two answer the other question — what exists and what
   * state is it in — and need `catalogue.manage` for it, because a draft is a
   * decision nobody has taken yet.
   *
   * Added when the console needed them. `updateService`, `updateRequestType`
   * and `updateForm` had been in the service layer since PH-2 with no route to
   * reach them, so the catalogue could be created and published but never
   * corrected.
   */
  app.get('/services', async (request) => {
    const ctx = contextOf(request);
    return { data: await catalogueService.listServices(ctx) };
  });

  app.get('/request-types', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ status: z.enum(['draft', 'published', 'retired']).optional(), serviceId: z.string().uuid().optional() })
      .parse(request.query);
    return { data: await catalogueService.listRequestTypes(ctx, query) };
  });

  app.patch('/services/:key', async (request) => {
    const ctx = contextOf(request);
    return catalogueService.updateService(ctx, byKey.parse(request.params).key, serviceUpdateSchema.strict().parse(request.body));
  });

  app.patch('/request-types/:key', async (request) => {
    const ctx = contextOf(request);
    return catalogueService.updateRequestType(
      ctx,
      byKey.parse(request.params).key,
      requestTypeUpdateSchema.strict().parse(request.body),
    );
  });

  app.patch('/forms/:key', async (request) => {
    const ctx = contextOf(request);
    return formService.updateForm(ctx, byKey.parse(request.params).key, updateFormSchema.strict().parse(request.body));
  });

  app.post('/services', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await catalogueService.createService(ctx, serviceSchema.strict().parse(request.body));
    reply.code(201);
    return created;
  });

  app.post('/request-types', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await catalogueService.createRequestType(ctx, requestTypeSchema.strict().parse(request.body));
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
    const created = await formService.createForm(ctx, createFormSchema.strict().parse(request.body));
    reply.code(201);
    return created;
  });

  app.post('/forms/:key/publish', async (request) => {
    const ctx = contextOf(request);
    return formService.publishForm(ctx, byKey.parse(request.params).key);
  });
}
