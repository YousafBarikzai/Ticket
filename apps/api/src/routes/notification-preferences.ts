import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { preferenceService, preferenceSchema } from '@itsm/module-notifications';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-11-E1 notification preferences.
 *
 * Mounted under `/me` for a person's own, and under `/users/:id` for an
 * administrator acting on someone else's — the same service, with the second
 * path checked as the administrative act it is.
 */
export async function notificationPreferenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/notification-preferences', async (request) => {
    const ctx = contextOf(request);
    return { data: await preferenceService.listPreferences(ctx) };
  });

  app.put('/me/notification-preferences', async (request) => {
    const ctx = contextOf(request);
    return preferenceService.setPreference(ctx, preferenceSchema.parse(request.body));
  });

  app.get('/users/:id/notification-preferences', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await preferenceService.listPreferences(ctx, id) };
  });

  app.put('/users/:id/notification-preferences', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return preferenceService.setPreference(ctx, preferenceSchema.parse(request.body), id);
  });
}
