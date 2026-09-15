import Fastify, { type FastifyInstance } from 'fastify';
import { disconnectDb, disconnectRedis, loadConfig, logger, metrics, modules, platformDb } from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { outboxPublisher } from '@itsm/module-integrations';
import { contextPlugin } from './plugins/context.js';
import { errorsPlugin } from './plugins/errors.js';
import { guardsPlugin } from './plugins/guards.js';
import { rawBodyPlugin } from './plugins/raw-body.js';
import { registerRoutes } from './routes/index.js';

/**
 * The API process (docs/architecture/03 §1).
 *
 * One Fastify server mounting every module. Building the app separately from
 * starting it lets the integration tests drive the real server in-process,
 * through the same plugin chain that runs in production.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  bootstrapModules();

  const app = Fastify({
    // A survey link carries a signed token in the path, around 300 characters;
    // Fastify's default of 100 answered every one of them with 414 in the
    // first live run. Two kilobytes is what browsers and mail clients carry
    // without complaint, and nothing else here comes close.
    maxParamLength: 2048,
    logger: false,
    // Cloudflare terminates TLS and adds the forwarding headers; trusting them
    // is what makes request.ip the real client for rate limiting and audit.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: true,
  });

  // Before anything that reads a body: the content-type parsers have to be in
  // place when the first route is registered.
  await app.register(rawBodyPlugin);
  await app.register(errorsPlugin);
  await app.register(contextPlugin);
  await app.register(guardsPlugin);

  app.addHook('onResponse', async (request, reply) => {
    metrics.observe('http_request_ms', reply.elapsedTime, {
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      status: String(reply.statusCode),
    });
  });

  app.get('/health/live', async () => ({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    try {
      await platformDb().$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'failed';
    }
    try {
      const { cache } = await import('@itsm/platform');
      await cache().ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'failed';
    }
    checks.modules = modules().length > 0 ? 'ok' : 'failed';

    const ready = Object.values(checks).every((value) => value === 'ok');
    reply.status(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not-ready', checks };
  });

  app.get('/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4');
    return metrics.toPrometheus();
  });

  await registerRoutes(app);

  logger.info('api built', { env: config.NODE_ENV, modules: modules().length });
  return app;
}

export async function startApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = await buildApp();

  // The registry is upserted at boot so the reconciler knows which consumers
  // are required before the first event arrives.
  await outboxPublisher.syncConsumerRegistry();

  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
  logger.info('api listening', { port: config.API_PORT });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await app.close();
    await disconnectDb();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return app;
}
