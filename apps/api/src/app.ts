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
 * A connection string carries a password, and both ioredis and Prisma put the
 * URL they were handed into some of their messages. `/health/ready` is
 * unauthenticated — Railway's health check calls it, and so can anyone — so a
 * reason served from here has to have the credentials taken out of it first.
 */
const CREDENTIALS = /\b([a-z][a-z0-9+.-]*):\/\/[^\s@/]*@/gi;

/**
 * Why a dependency check failed, in a form that is safe to serve publicly.
 *
 * The alternative, and what this replaces, is the word `failed`. That is what
 * the first live deploy reported for an evening while the host, port, user and
 * password were every one of them correct — because `failed` is the same word
 * for a wrong password, a name that does not resolve and a refused connection,
 * and those are three problems with three different fixes. The error object
 * said which; the only process that had it caught it, reduced it to a boolean
 * and dropped it, leaving the fault to be guessed at from outside.
 */
export function failureDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const safe = raw.replace(CREDENTIALS, (_match, scheme: string) => `${scheme}://***@`);
  // One line, and bounded: this is a value in a small JSON body that a health
  // check polls every few seconds, not a log. The first line of an ioredis or
  // Prisma message is the part that names the fault; what follows it is a
  // stack, or a link to documentation about the stack.
  const line = safe.split('\n')[0]?.trim() ?? '';
  if (line === '') return 'failed';
  return `failed: ${line.length > 200 ? `${line.slice(0, 197)}...` : line}`;
}

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
    const checks: Record<string, string> = {};
    try {
      await platformDb().$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (error) {
      checks.database = failureDetail(error);
    }
    try {
      const { cache } = await import('@itsm/platform');
      await cache().ping();
      checks.redis = 'ok';
    } catch (error) {
      checks.redis = failureDetail(error);
    }
    checks.modules = modules().length > 0 ? 'ok' : 'failed: no module registered';

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

  // `::` rather than `0.0.0.0`, and the difference is not cosmetic: `0.0.0.0`
  // binds IPv4 only, and Railway's private network — which its edge proxy and
  // its health checks both reach a container over — is IPv6. A process bound
  // to `0.0.0.0` there is a process nothing can connect to, on any port.
  //
  // Node binds dual-stack by default, so `::` accepts IPv4 as well and every
  // other way this runs (docker compose, a laptop, the walking skeleton on
  // 127.0.0.1) is unaffected.
  await app.listen({ port: config.API_PORT, host: '::' });
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
