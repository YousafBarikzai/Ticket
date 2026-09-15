import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { packService, upgradeInputSchema } from '@itsm/module-esm';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-22 ESM packs: what this deployment ships, what this tenant took, and
 * what a newer version would change.
 *
 * Both writes have a preview beside them that touches nothing, because both
 * are wide: installing writes across five modules at once, and an upgrade can
 * replace configuration somebody edited. An administrator should be able to
 * see exactly what either would do before agreeing to it.
 */
export async function packRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(30) });

  app.get('/packs', async (request) => {
    const ctx = contextOf(request);
    const packs = await packService.listPacks(ctx);
    return {
      packs: packs.map((pack) => ({
        ...pack,
        installed: pack.installed
          ? {
              version: pack.installed.version,
              installedAt: pack.installed.installedAt.toISOString(),
              lastRequestAt: pack.installed.lastRequestAt?.toISOString() ?? null,
            }
          : null,
      })),
    };
  });

  app.get('/packs/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const pack = await packService.describePack(ctx, key);
    return {
      ...pack,
      installed: pack.installed
        ? {
            version: pack.installed.version,
            installedAt: pack.installed.installedAt.toISOString(),
            lastRequestAt: pack.installed.lastRequestAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  /** What installing would create, and what it would collide with. Writes nothing. */
  app.get('/packs/:key/preview', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return packService.previewInstall(ctx, key);
  });

  app.post('/packs/:key/install', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const result = await packService.installPack(ctx, key);
    // 202 rather than 201 when it stopped part way: something was created, and
    // the caller has to look at what.
    reply.code(result.stoppedAt ? 202 : 201);
    return result;
  });

  /** The diff against a newer version of an installed pack. Writes nothing. */
  app.get('/packs/:key/upgrade', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return packService.previewUpgrade(ctx, key);
  });

  app.post('/packs/:key/upgrade', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const body = upgradeInputSchema.parse(request.body ?? {});
    return packService.applyUpgrade(ctx, key, body);
  });
}
