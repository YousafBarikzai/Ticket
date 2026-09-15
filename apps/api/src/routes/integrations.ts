import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actionService, credentialService, actionSchema, credentialSchema } from '@itsm/module-integrations';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-14 credentials, actions and the error queue.
 *
 * The credential routes have one property worth stating out loud: **there is no
 * route that returns a credential**. Not to an administrator, not to a platform
 * operator, not with a flag. A store that can read a secret back is a store
 * whose read path is the thing an attacker wants.
 */
export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  const byRef = z.object({ ref: z.string().min(1).max(80) });
  const byId = z.object({ id: z.string().uuid() });
  const byKey = z.object({ key: z.string().min(1).max(80) });

  app.get('/credentials', async (request) => {
    const ctx = contextOf(request);
    // Fingerprints and metadata. Never values.
    return { data: await credentialService.listCredentials(ctx) };
  });

  app.post('/credentials', async (request, reply) => {
    const ctx = contextOf(request);
    const stored = await credentialService.storeCredential(ctx, credentialSchema.parse(request.body));
    return reply.code(201).send(stored);
  });

  app.post('/credentials/:ref/rotate', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ value: z.string().min(1).max(8_192) }).parse(request.body);
    return credentialService.rotateCredential(ctx, byRef.parse(request.params).ref, body.value);
  });

  app.delete('/credentials/:ref', async (request, reply) => {
    const ctx = contextOf(request);
    await credentialService.deleteCredential(ctx, byRef.parse(request.params).ref);
    return reply.code(204).send();
  });

  app.get('/actions', async (request) => {
    const ctx = contextOf(request);
    return { data: await actionService.listActions(ctx) };
  });

  app.post('/actions', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await actionService.createAction(ctx, actionSchema.parse(request.body));
    return reply.code(201).send(created);
  });

  app.post('/actions/:key/publish', async (request) => {
    const ctx = contextOf(request);
    return actionService.publishAction(ctx, byKey.parse(request.params).key);
  });

  app.get('/error-queue', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ status: z.string().default('open') }).parse(request.query);
    return { data: await actionService.listErrorQueue(ctx, query.status) };
  });

  app.post('/error-queue/:id/replay', async (request) => {
    const ctx = contextOf(request);
    // Replays with the original idempotency key, so pressing retry cannot
    // create a duplicate of something the first attempt already did.
    return actionService.replayError(ctx, byId.parse(request.params).id);
  });

  app.post('/error-queue/:id/dismiss', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(request.body);
    await actionService.dismissError(ctx, byId.parse(request.params).id, body.reason);
    return { status: 'dismissed' };
  });
}
