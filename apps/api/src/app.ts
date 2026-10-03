import Fastify, { type FastifyInstance } from 'fastify';
import {
  checkDemoInterlock,
  configWarnings,
  disconnectDb,
  disconnectRedis,
  loadConfig,
  logger,
  metrics,
  modules,
  platformDb,
  reportConfigWarnings,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { outboxPublisher } from '@itsm/module-integrations';
import { contextPlugin } from './plugins/context.js';
import { demoPlugin } from './plugins/demo.js';
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

/** What `/health/ready` asks, injectable so the answer's shape is testable without a database. */
export interface ReadinessProbes {
  database(): Promise<unknown>;
  redis(): Promise<unknown>;
  moduleCount(): number;
  /** Configuration warning codes (D24): codes only, never a configured value. */
  warnings(): readonly string[];
}

export interface ReadinessBody {
  status: 'ready' | 'not-ready';
  checks: Record<string, string>;
  warnings?: string[];
}

/**
 * The readiness answer.
 *
 * `warnings` sits **beside** `checks`, never inside it, and never decides the
 * status (D24, SPEC v3 §6.5). Railway's health check and the post-deploy smoke
 * test both read the status code, and a deployment signing links with the
 * public development secret is still a deployment that is up: refusing it
 * would turn a forgotten variable into an outage. The deploy reads `warnings`
 * separately and prints them as annotations (`post-deploy-check.ts`
 * `readinessWarnings`). The key is absent when there is nothing to say, so a
 * clean deployment's body is exactly what it was before.
 *
 * The endpoint is public, so it says which warning and never what the value
 * is; anyone who learns from it that the default is in use could have learned
 * the same by forging one token, and the fix is the operator's banner.
 */
export async function readiness(probes: ReadinessProbes): Promise<{ statusCode: 200 | 503; body: ReadinessBody }> {
  const checks: Record<string, string> = {};
  try {
    await probes.database();
    checks.database = 'ok';
  } catch (error) {
    checks.database = failureDetail(error);
  }
  try {
    await probes.redis();
    checks.redis = 'ok';
  } catch (error) {
    checks.redis = failureDetail(error);
  }
  checks.modules = probes.moduleCount() > 0 ? 'ok' : 'failed: no module registered';

  const ready = Object.values(checks).every((value) => value === 'ok');
  const warnings = [...probes.warnings()];
  return {
    statusCode: ready ? 200 : 503,
    body: { status: ready ? 'ready' : 'not-ready', checks, ...(warnings.length > 0 ? { warnings } : {}) },
  };
}

/** `/health/live` and `/health/ready`, unauthenticated (`plugins/context.ts`), for Railway and the deploy. */
export function healthRoutes(app: FastifyInstance, probes: ReadinessProbes): void {
  app.get('/health/live', async () => ({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  app.get('/health/ready', async (_request, reply) => {
    const { statusCode, body } = await readiness(probes);
    reply.status(statusCode);
    return body;
  });
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
  // A demo switched on with a tenant slug that fails the boot interlock is
  // said at boot, not on the first visitor's request; the API starts either
  // way and only the demo is refused (§4.9).
  checkDemoInterlock(config);

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
  // After the rate limiter, and before any route, so its route table (what
  // `demo-policy.test.ts` checks the policy against) sees every one of them.
  // It does nothing for a standard tenant (SPEC v3 §4.7.7).
  await app.register(demoPlugin);

  app.addHook('onResponse', async (request, reply) => {
    metrics.observe('http_request_ms', reply.elapsedTime, {
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      status: String(reply.statusCode),
    });
  });

  healthRoutes(app, {
    database: () => platformDb().$queryRaw`SELECT 1`,
    redis: async () => {
      const { cache } = await import('@itsm/platform');
      return cache().ping();
    },
    moduleCount: () => modules().length,
    warnings: () => configWarnings(loadConfig()).map((warning) => warning.code),
  });

  app.get('/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4');
    return metrics.toPrometheus();
  });

  await registerRoutes(app);

  logger.info('api built', { env: config.NODE_ENV, modules: modules().length });
  return app;
}

/**
 * The addresses to listen on, in order of preference.
 *
 * `::` first, and the difference from `0.0.0.0` is not cosmetic: `0.0.0.0`
 * binds IPv4 only, and Railway's private network — which its edge proxy and
 * its health checks both reach a container over — is IPv6. A process bound
 * to `0.0.0.0` there is a process nothing can connect to, on any port. Node
 * binds `::` dual-stack, so it accepts IPv4 as well.
 *
 * `0.0.0.0` second, for a host with no IPv6 at all, where binding `::` fails
 * with `EAFNOSUPPORT` before anything listens — a container with IPv6
 * switched off, which is where the demo harness and the integrators' live
 * checks run. Only that error falls through: a port in use is still a
 * failure to start.
 *
 * `API_HOST` names one address and replaces both, for a deployment that must
 * listen on exactly one interface. It is read here rather than through the
 * validated configuration because nothing else needs it and it changes
 * nothing about how the API behaves once it is listening.
 */
export function listenHosts(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const configured = env.API_HOST?.trim();
  return configured ? [configured] : ['::', '0.0.0.0'];
}

/** Listens on the first of `hosts` this machine supports, and returns which one. */
export async function listenOnFirstHost(
  app: Pick<FastifyInstance, 'listen'>,
  port: number,
  hosts: readonly string[],
): Promise<string> {
  for (const [index, host] of hosts.entries()) {
    try {
      await app.listen({ port, host });
      return host;
    } catch (error) {
      const unsupported = (error as NodeJS.ErrnoException).code === 'EAFNOSUPPORT';
      if (!unsupported || index === hosts.length - 1) throw error;
      logger.warn('this host has no IPv6; listening on IPv4 only', { port, tried: host, next: hosts[index + 1] });
    }
  }
  throw new Error('no address to listen on');
}

export async function startApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = await buildApp();

  // The registry is upserted at boot so the reconciler knows which consumers
  // are required before the first event arrives.
  await outboxPublisher.syncConsumerRegistry();

  const host = await listenOnFirstHost(app, config.API_PORT, listenHosts());
  logger.info('api listening', { port: config.API_PORT, host });

  // D24: warn, never refuse. After `listen`, so a slow or absent Redis delays
  // nothing a health check waits for; the report never throws.
  const configReport = await reportConfigWarnings(config.OTEL_SERVICE_NAME);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    configReport.stop();
    await app.close();
    await disconnectDb();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return app;
}
