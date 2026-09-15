import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createHash } from 'node:crypto';
import { RateLimitedError, ValidationError, cache, loadConfig, tenantKey, logger } from '@itsm/platform';

/**
 * Rate limiting and idempotency (specification §7).
 *
 * Both are per tenant and per token, and both fail open on a Redis outage:
 * losing a cache should degrade protection, not the service.
 */

const IDEMPOTENCY_TTL_SECONDS = 86_400;

/** Search and bulk endpoints get their own, smaller budget. */
function budgetFor(url: string, base: number): { limit: number; bucket: string } {
  if (url.startsWith('/api/v1/search')) return { limit: Math.max(30, Math.floor(base / 10)), bucket: 'search' };
  if (url.includes(':bulk')) return { limit: Math.max(10, Math.floor(base / 30)), bucket: 'bulk' };
  if (url.startsWith('/api/v1/auth')) return { limit: 30, bucket: 'auth' };
  return { limit: base, bucket: 'default' };
}

export const guardsPlugin = fp(async (app: FastifyInstance) => {
  const config = loadConfig();

  app.addHook('preHandler', async (request, reply) => {
    const ctx = request.tenantContext;
    if (!ctx) return;

    const tokenId = request.token?.subject ?? 'anonymous';
    const { limit, bucket } = budgetFor(request.url, config.RATE_LIMIT_PER_MINUTE);
    const window = Math.floor(Date.now() / 60_000);
    const key = tenantKey(ctx.tenantId, 'rl', bucket, tokenId, window);

    try {
      const redis = cache();
      const used = await redis.incr(key);
      if (used === 1) await redis.expire(key, 120);

      reply.header('x-ratelimit-limit', String(limit));
      reply.header('x-ratelimit-remaining', String(Math.max(0, limit - used)));

      if (used > limit) {
        const retryAfter = 60 - Math.floor((Date.now() % 60_000) / 1000);
        throw new RateLimitedError(retryAfter);
      }
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      logger.warn('rate limiting unavailable; allowing the request', { error: (error as Error).message });
    }
  });

  /**
   * Idempotency keys (specification §7). A replay returns the original
   * response; the same key with a different body is a client bug, so it is
   * refused rather than silently treated as new.
   */
  app.addHook('preHandler', async (request, reply) => {
    const ctx = request.tenantContext;
    const key = request.headers['idempotency-key'];
    if (!ctx || typeof key !== 'string' || request.method !== 'POST') return;
    if (key.length > 200) throw new ValidationError('idempotency key is too long');

    const bodyHash = createHash('sha256').update(JSON.stringify(request.body ?? null)).digest('hex');
    const storeKey = tenantKey(ctx.tenantId, 'idem', key);

    try {
      const existing = await cache().get(storeKey);
      if (existing) {
        const record = JSON.parse(existing) as { bodyHash: string; status: number; body: unknown };
        if (record.bodyHash !== bodyHash) {
          throw new ValidationError('this idempotency key was used with a different request body');
        }
        reply.header('idempotent-replay', 'true');
        reply.status(record.status).send(record.body);
        return reply;
      }
      request.idempotency = { key: storeKey, bodyHash };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.warn('idempotency store unavailable; proceeding without replay protection', {
        error: (error as Error).message,
      });
    }
    return undefined;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const record = request.idempotency;
    if (!record || reply.statusCode >= 400) return payload;
    try {
      await cache().set(
        record.key,
        JSON.stringify({ bodyHash: record.bodyHash, status: reply.statusCode, body: payload }),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
      );
    } catch {
      // The response is already correct; failing to remember it is acceptable.
    }
    return payload;
  });

  app.decorateRequest('idempotency', undefined);
});

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { key: string; bodyHash: string };
  }
}
