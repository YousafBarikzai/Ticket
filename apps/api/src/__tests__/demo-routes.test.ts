import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_COMPANY, DEMO_COPY, DEMO_FEATURES, DEMO_KEYS, type DemoLiveRecord } from '@itsm/contracts/demo';
import { demoStatusSchema } from '@itsm/contracts/demo/schemas';

/**
 * The shared demo's API routes (SPEC v3 §4.6.4; A3 §6.4): the public status
 * and the visitor reset, in the order their refusals are checked; `/me.demo`;
 * the stream registry that ends old-generation event streams; and the error
 * handler's `demo_disabled` mapping (A3 §7.2).
 *
 * Redis, the queue, the audit write and the ledger are doubles: what is
 * pinned here is each step's answer and that nothing is written before every
 * check has passed. The same routes against real Redis, BullMQ and Postgres
 * are `tests/integration/demo-auth.test.ts`.
 */

const redis = vi.hoisted(() => ({
  values: new Map<string, string>(),
  ttls: new Map<string, number>(),
  writes: [] as string[],
  failReads: false,
  failWrites: false,
}));
const calls = vi.hoisted(() => ({
  enqueued: [] as unknown[][],
  audits: [] as unknown[][],
  failEnqueue: false,
  ledger: { manual: 0, builds: [] as number[], missing: false },
  queries: [] as string[],
  connections: [] as EventEmitter[],
}));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  const fake = {
    mget: async (...keys: string[]) => {
      if (redis.failReads) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      return keys.map((key) => redis.values.get(key) ?? null);
    },
    pttl: async (key: string) => (redis.values.has(key) ? (redis.ttls.get(key) ?? -1) : -2),
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (redis.failWrites) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      if (args.includes('NX') && redis.values.has(key)) return null;
      redis.values.set(key, value);
      redis.writes.push(`set ${key} ${args.join(' ')}`);
      return 'OK';
    },
    del: async (...keys: string[]) => {
      redis.writes.push(`del ${keys.join(' ')}`);
      return keys.filter((key) => redis.values.delete(key)).length;
    },
  };
  return {
    ...actual,
    cache: () => fake,
    subscriber: () => ({
      duplicate: () => {
        const connection = Object.assign(new EventEmitter(), {
          subscribed: [] as string[],
          subscribe: async (channel: string) => {
            connection.subscribed.push(channel);
            return 1;
          },
          quit: async () => 'OK',
          disconnect: () => undefined,
        });
        calls.connections.push(connection);
        return connection;
      },
    }),
    enqueue: async (...args: unknown[]) => {
      if (calls.failEnqueue) throw new Error('queue unavailable');
      calls.enqueued.push(args);
      return 'job-1';
    },
    recordAudit: async (...args: unknown[]) => {
      calls.audits.push(args);
      return { id: 'audit-1', hash: 'h' };
    },
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
    platformDb: () => ({
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        calls.queries.push(sql);
        if (calls.ledger.missing) {
          throw Object.assign(new Error('relation "demo_generation" does not exist'), { code: 'P2010', meta: { code: '42P01' } });
        }
        if (sql.includes('count(*)')) return [{ count: calls.ledger.manual }];
        return calls.ledger.builds.map((build_ms) => ({ build_ms }));
      },
    }),
  };
});

vi.mock('@itsm/module-identity', () => ({ resolveActor: async () => null, scimTokenService: {}, userService: {} }));
vi.mock('@itsm/module-tenancy', () => ({ tenantService: {} }));

const platform = await import('@itsm/platform');
const { createContext, buildPermissionSet, ForbiddenError, DemoUnavailableError, logger, resetConfig } = platform;
const { errorsPlugin, answerFor } = await import('../plugins/errors.js');
const demoModule = await import('../routes/demo.js');
const {
  DemoStreamRegistry,
  demoRoutes,
  demoStreamIsCurrent,
  ensureDemoEventSubscriber,
  manualResetJobId,
  meDemo,
  medianEtaSeconds,
  onDemoEvent,
  readResetLedger,
  stopDemoEventSubscriber,
} = demoModule;

const DEMO_TENANT = '0190f3a5-0000-7000-8000-00000000d001';
const STANDARD_TENANT = '0190f3a5-0000-7000-8000-00000000a001';
const EMMA = '0190f3a5-0000-7000-8000-0000000000e1';
const ALEX = '0190f3a5-0000-7000-8000-0000000000a1';
const JORDAN = '0190f3a5-0000-7000-8000-0000000000f1';
const SERVICE_DESK = '0190f3a5-0000-7000-8000-0000000000c1';
const SID = 'demo-6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

const DEMO = {
  sid: SID,
  persona: 'agent' as const,
  app: 'workbench' as const,
  generation: 41,
  personaUserIds: { employee: EMMA, agent: ALEX, admin: JORDAN },
  agentTeamIds: [SERVICE_DESK],
};

function liveRecord(overrides: Partial<DemoLiveRecord> = {}): DemoLiveRecord {
  const now = Date.now();
  return {
    v: 1,
    tenantId: DEMO_TENANT,
    slug: 'demo',
    generation: 41,
    builtAt: now - 3_600_000,
    anchor: now - 3_600_000,
    lastResetAt: now - 3_600_000,
    lastResetReason: 'scheduled',
    personas: { employee: { userId: EMMA }, agent: { userId: ALEX }, admin: { userId: JORDAN } },
    agentTeamIds: [SERVICE_DESK],
    ...overrides,
  };
}

function demoEnv(overrides: Record<string, string> = {}): void {
  const env = { DATABASE_URL_APP: 'postgresql://app_user:pw@127.0.0.1:5432/itsm', DEMO_MODE: 'on', DEMO_TENANT_SLUG: 'demo', LOG_SILENT: '1', ...overrides };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetConfig();
}

/**
 * The demo prefix behind a stand-in for the context plugin: `x-test-session`
 * says whether the caller is a demo visitor, a standard user or nobody.
 */
async function api(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(errorsPlugin);
  app.decorateRequest('tenantContext', undefined);
  app.addHook('onRequest', async (request) => {
    request.correlationId = 'test';
    const session = request.headers['x-test-session'];
    if (session === 'demo' || session === 'standard') {
      request.tenantContext = createContext({
        tenantId: session === 'demo' ? DEMO_TENANT : STANDARD_TENANT,
        correlationId: 'test',
        actor: { type: 'user', id: ALEX, displayName: 'Alex Morgan' },
        permissions: buildPermissionSet([{ key: 'ticket.read', scope: 'any' }]),
        ...(session === 'demo' ? { demo: DEMO } : { ip: '203.0.113.7' }),
      });
    }
  });
  await app.register(demoRoutes, { prefix: '/api/demo/v1' });
  app.get('/api/v1/forbidden/:key', async (request) => {
    throw new ForbiddenError((request.params as { key: string }).key);
  });
  app.get('/api/v1/unavailable', async () => {
    throw new DemoUnavailableError('paused');
  });
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  demoEnv();
  redis.values.clear();
  redis.ttls.clear();
  redis.writes = [];
  redis.failReads = false;
  redis.failWrites = false;
  calls.enqueued = [];
  calls.audits = [];
  calls.failEnqueue = false;
  calls.ledger = { manual: 0, builds: [], missing: false };
  calls.queries = [];
  app = await api();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetConfig();
});

const status = () => app.inject({ method: 'GET', url: '/api/demo/v1/status' });
/** `body: null` sends no body at all. */
const reset = (session: 'demo' | 'standard' | 'none' = 'demo', body: unknown = { confirm: 'RESET' }) =>
  app.inject({
    method: 'POST',
    url: '/api/demo/v1/reset',
    headers: { 'x-test-session': session, ...(body === null ? {} : { 'content-type': 'application/json' }) },
    ...(body === null ? {} : { payload: JSON.stringify(body) }),
  });

function put(key: string, value: unknown, ttlMs?: number): void {
  redis.values.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  if (ttlMs !== undefined) redis.ttls.set(key, ttlMs);
}

describe('GET /api/demo/v1/status', () => {
  it('answers as an unknown path does while the demo is off', async () => {
    demoEnv({ DEMO_MODE: 'off' });
    const response = await status();
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/not_found', detail: 'no route for GET /api/demo/v1/status' });
  });

  it('answers 503 misconfigured when the slug failed the boot interlock, and reads nothing', async () => {
    demoEnv({ DEMO_TENANT_SLUG: 'northwind' });
    put(DEMO_KEYS.live, liveRecord());
    const response = await status();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/demo_unavailable', reason: 'misconfigured' });
  });

  it('is public for five seconds, strictly valid, and names no tenant, user or token', async () => {
    put(DEMO_KEYS.live, liveRecord());
    const response = await status();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=5');
    const body = response.json() as Record<string, unknown>;
    expect(demoStatusSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ state: 'ready', generation: 41, resetBlocked: false, uploads: false, company: { name: DEMO_COMPANY.name, fictional: true } });
    const text = response.body;
    for (const secret of [DEMO_TENANT, EMMA, ALEX, JORDAN, SERVICE_DESK, 'itsmdemo_', 'tenantId', 'userId']) expect(text).not.toContain(secret);
  });

  it('says preparing, building, paused and blocked as the records say', async () => {
    expect((await status()).json()).toMatchObject({ state: 'preparing', resetBlocked: true, generation: null });

    put(DEMO_KEYS.build, { v: 1, state: 'building', generation: 1, reason: 'initial', startedAt: Date.now() - 10_000, step: 'tickets', stepIndex: 5, steps: 11, etaSec: 200 });
    expect((await status()).json()).toMatchObject({ state: 'building', build: { etaSec: 200 }, resetBlocked: true });

    redis.values.clear();
    put(DEMO_KEYS.live, liveRecord());
    put(DEMO_KEYS.resetCooldown, { at: Date.now() - 60_000, generation: 41, reason: 'manual' });
    expect((await status()).json()).toMatchObject({ state: 'ready', resetBlocked: true });

    put(DEMO_KEYS.paused, 'not json');
    expect((await status()).json()).toMatchObject({ state: 'paused', resetBlocked: true });
  });

  it('answers 503 store when Redis does not answer', async () => {
    redis.failReads = true;
    const response = await status();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: 'store' });
  });
});

describe('POST /api/demo/v1/reset, step by step (§4.6.4)', () => {
  beforeEach(() => {
    put(DEMO_KEYS.live, liveRecord());
  });

  it('1 · answers as an unknown path does while the demo is off', async () => {
    demoEnv({ DEMO_MODE: 'off' });
    const response = await reset('none');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ detail: 'no route for POST /api/demo/v1/reset' });
  });

  it('2 · refuses a real session with 403, before it looks at the body', async () => {
    const response = await reset('standard', { confirm: 'nope' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/forbidden', detail: DEMO_COPY.resetOnlyInDemo });
    expect(redis.writes).toEqual([]);
  });

  it('3 · refuses anything but exactly { "confirm": "RESET" } with 422', async () => {
    for (const body of [{}, { confirm: 'reset' }, { confirm: 'RESET', also: true }, { confirm: true }, []]) {
      const response = await reset('demo', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(422);
    }
    expect((await reset('demo', null)).statusCode).toBe(422);
    expect(redis.writes).toEqual([]);
  });

  it('4 · answers 503 paused while the operator has paused the demo', async () => {
    put(DEMO_KEYS.paused, { by: 'operator', at: 1, reason: 'test' });
    put(DEMO_KEYS.build, 'anything');
    const response = await reset();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: 'paused' });
  });

  it('5 · answers 409 building while a build, the lock or another request exists', async () => {
    for (const key of [DEMO_KEYS.build, DEMO_KEYS.resetLock, DEMO_KEYS.resetRequested]) {
      redis.values.delete(DEMO_KEYS.build);
      redis.values.delete(DEMO_KEYS.resetLock);
      redis.values.delete(DEMO_KEYS.resetRequested);
      put(key, 'held');
      // A cooldown as well: the building answer comes first.
      put(DEMO_KEYS.resetCooldown, { at: Date.now(), generation: 41, reason: 'manual' }, 1_800_000);
      const response = await reset();
      expect(response.statusCode, key).toBe(409);
      expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/conflict', state: 'building', detail: DEMO_COPY.resetRunning });
    }
    expect(calls.enqueued).toEqual([]);
  });

  it('6 · answers 429 with the cooldown left, in the body and in Retry-After', async () => {
    put(DEMO_KEYS.resetCooldown, { at: Date.now() - 600_000, generation: 41, reason: 'scheduled' }, 1_199_500);
    const response = await reset();
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('1200');
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/rate_limited', retryAfterSec: 1200 });
  });

  it('6 · reads the wait from the record when the key has no expiry', async () => {
    put(DEMO_KEYS.resetCooldown, { at: Date.now() - 1_500_000, generation: 41, reason: 'scheduled' });
    const response = await reset();
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(299);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(300);
  });

  it('6b · answers 429 until the backoff after a failed build ends', async () => {
    put(DEMO_KEYS.resetBackoff, { v: 1, failures: 2, retryAt: Date.now() + 840_000, step: 'checks' }, 900_000);
    const response = await reset();
    expect(response.statusCode).toBe(429);
    expect(Math.abs(Number(response.headers['retry-after']) - 840)).toBeLessThanOrEqual(1);
  });

  it('answers 503 preparing with no live generation, and demo_reset when the session is a generation behind', async () => {
    redis.values.delete(DEMO_KEYS.live);
    expect((await reset()).json()).toMatchObject({ status: 503, reason: 'preparing' });
    put(DEMO_KEYS.live, liveRecord({ generation: 42 }));
    const response = await reset();
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/demo_reset' });
    expect(redis.writes).toEqual([]);
  });

  it('7 · answers 409 when another reset claims the request first', async () => {
    // Between this request's read and its write, another one wrote the claim.
    const claimed = vi.spyOn(redis.values, 'has').mockImplementation(function (this: Map<string, string>, key: string) {
      return key === DEMO_KEYS.resetRequested ? true : Map.prototype.has.call(this, key);
    });
    const response = await reset();
    claimed.mockRestore();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ state: 'building' });
    expect(calls.enqueued).toEqual([]);
  });

  it('8 · claims the request, audits it and enqueues the manual build with a fresh job id', async () => {
    calls.ledger.builds = [200_000, 190_000, 260_000];
    const response = await reset();
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ nextGeneration: 42, etaSec: 200 });

    expect(redis.writes).toEqual([`set ${DEMO_KEYS.resetRequested} EX 300 NX`]);
    const marker = JSON.parse(redis.values.get(DEMO_KEYS.resetRequested)!) as Record<string, unknown>;
    expect(marker).toMatchObject({ generation: 41 });
    expect(marker.sidHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(marker)).not.toContain(SID);

    expect(calls.enqueued).toHaveLength(1);
    const [ctx, queueName, jobName, payload, options] = calls.enqueued[0] as [{ tenantId: string }, string, string, unknown, unknown];
    expect(ctx.tenantId).toBe(DEMO_TENANT);
    expect([queueName, jobName, payload]).toEqual(['demo', 'demo.reset', { reason: 'manual', requestedGeneration: 41 }]);
    expect(options).toEqual({ attempts: 1, removeOnComplete: true, removeOnFail: true, jobId: 'demo-reset-manual-g41-a1' });

    expect(calls.audits).toHaveLength(1);
    const [, auditCtx, audit] = calls.audits[0] as [unknown, { ip?: string; userAgent?: string; actor: { id: string } }, Record<string, unknown>];
    expect(audit).toMatchObject({ action: 'demo.reset.requested', targetType: 'tenant', targetId: DEMO_TENANT });
    expect(auditCtx.actor.id).toBe(ALEX);
    expect(auditCtx.ip).toBeUndefined();
    expect(auditCtx.userAgent).toBeUndefined();
  });

  it('8 · numbers the job after the manual attempts the ledger already holds for the next generation', async () => {
    calls.ledger.manual = 2;
    expect((await reset()).statusCode).toBe(202);
    expect((calls.enqueued[0]![4] as { jobId: string }).jobId).toBe('demo-reset-manual-g41-a3');
    expect(calls.queries.some((sql) => sql.includes("reason = 'manual' AND generation = ?"))).toBe(true);
  });

  it('8 · releases the claim when the job cannot be enqueued, so the visitor can try again at once', async () => {
    calls.failEnqueue = true;
    const response = await reset();
    expect(response.statusCode).toBe(500);
    expect(redis.values.has(DEMO_KEYS.resetRequested)).toBe(false);
    expect(redis.writes.at(-1)).toBe(`del ${DEMO_KEYS.resetRequested}`);
  });

  it('fails closed with 503 store when Redis does not answer, reading or claiming', async () => {
    redis.failReads = true;
    expect((await reset()).json()).toMatchObject({ status: 503, reason: 'store' });
    redis.failReads = false;
    redis.failWrites = true;
    expect((await reset()).json()).toMatchObject({ status: 503, reason: 'store' });
    expect(calls.enqueued).toEqual([]);
  });
});

describe('the reset ledger', () => {
  it('reads an absent ledger as empty, and says so once', async () => {
    const error = vi.spyOn(logger, 'error');
    calls.ledger.missing = true;
    expect(await readResetLedger(41)).toEqual({ attempt: 1, etaSec: 180 });
    expect(await readResetLedger(41)).toEqual({ attempt: 1, etaSec: 180 });
    expect(error.mock.calls.filter(([message]) => String(message).includes('ledger does not exist')).length).toBeLessThanOrEqual(1);
  });

  it('takes the median of the last good builds, 180 s with none', () => {
    expect(medianEtaSeconds([])).toBe(180);
    expect(medianEtaSeconds([200_000])).toBe(200);
    expect(medianEtaSeconds([200_000, 100_000, 300_000, 150_000])).toBe(175);
    expect(medianEtaSeconds([Number.NaN, 0, -5, 240_400])).toBe(240);
  });

  it('spells the job id with the generation and the attempt', () => {
    expect(manualResetJobId(41, 1)).toBe('demo-reset-manual-g41-a1');
    expect(manualResetJobId(7, 3)).toBe('demo-reset-manual-g7-a3');
  });
});

describe('/me.demo', () => {
  it('names the persona, area, generation and company, and lists every disabled feature', () => {
    expect(meDemo(DEMO)).toEqual({
      persona: 'agent',
      area: 'workbench',
      generation: 41,
      company: 'Northwind Traders (UK)',
      disabledFeatures: [...DEMO_FEATURES],
      personaUserIds: { employee: EMMA, agent: ALEX, admin: JORDAN },
      agentTeamIds: [SERVICE_DESK],
    });
  });
});

describe('old-generation event streams', () => {
  it('ends only the streams of an older generation, once each', () => {
    const registry = new DemoStreamRegistry();
    const ended: string[] = [];
    registry.add({ generation: 40, end: () => ended.push('40') });
    const untrack = registry.add({ generation: 40, end: () => ended.push('40b') });
    registry.add({ generation: 41, end: () => ended.push('41') });
    untrack();
    expect(registry.endOlderThan(41)).toBe(1);
    expect(ended).toEqual(['40']);
    expect(registry.endOlderThan(41)).toBe(0);
    expect(registry.size).toBe(1);
  });

  it('acts on a swapped event, and ignores everything else', () => {
    const registry = new DemoStreamRegistry();
    const ended: number[] = [];
    registry.add({ generation: 40, end: () => ended.push(40) });
    expect(onDemoEvent(JSON.stringify({ type: 'paused', at: 1 }), registry)).toBe(0);
    expect(onDemoEvent('not json', registry)).toBe(0);
    expect(onDemoEvent(JSON.stringify({ type: 'swapped', generation: 41 }), registry)).toBe(0);
    const swapped = { type: 'swapped', generation: 41, previousGeneration: 40, previousTenantId: null, reason: 'scheduled', at: 1 };
    expect(onDemoEvent(JSON.stringify(swapped), registry)).toBe(1);
    expect(ended).toEqual([40]);
  });

  it('subscribes once to demo:events and ends old streams when a swap is announced', async () => {
    const registry = new DemoStreamRegistry();
    const ended: number[] = [];
    registry.add({ generation: 40, end: () => ended.push(40) });
    await Promise.all([ensureDemoEventSubscriber(registry), ensureDemoEventSubscriber(registry)]);
    const connection = calls.connections.at(-1) as EventEmitter & { subscribed: string[] };
    expect(connection.subscribed).toEqual(['demo:events']);
    connection.emit('message', 'demo:other', JSON.stringify({ type: 'swapped', generation: 41, previousGeneration: 40, previousTenantId: null, reason: 'manual', at: 1 }));
    expect(ended).toEqual([]);
    connection.emit('message', 'demo:events', JSON.stringify({ type: 'swapped', generation: 41, previousGeneration: 40, previousTenantId: null, reason: 'manual', at: 1 }));
    expect(ended).toEqual([40]);
    await stopDemoEventSubscriber();
  });

  it('tells the heartbeat whether a stream is still on the live generation, failing closed', async () => {
    put(DEMO_KEYS.live, liveRecord());
    expect(await demoStreamIsCurrent(41)).toBe(true);
    expect(await demoStreamIsCurrent(40)).toBe(false);
    put(DEMO_KEYS.live, 'garbled');
    expect(await demoStreamIsCurrent(41)).toBe(false);
    redis.failReads = true;
    expect(await demoStreamIsCurrent(41)).toBe(false);
  });
});

describe('the error handler in a demo session (A3 §7.2)', () => {
  const forbidden = (key: string, session: 'demo' | 'standard') =>
    app.inject({ method: 'GET', url: `/api/v1/forbidden/${key}`, headers: { 'x-test-session': session } });

  it('answers a stripped permission with demo_disabled and the feature', async () => {
    const response = await forbidden('webhook.manage', 'demo');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      type: 'https://docs.itsm.example/problems/demo_disabled',
      title: 'Not available in the demo',
      demo: true,
      feature: 'integrations',
      detail: 'This is a shared demo, so connecting to other systems is turned off. Everything else works as in the full product.',
    });
    expect((await forbidden('platform.tenant.manage', 'demo')).json()).toMatchObject({ feature: 'platform' });
  });

  it('leaves a kept permission, and every refusal outside the demo, as it was', async () => {
    expect((await forbidden('ticket.read', 'demo')).json()).toMatchObject({ type: 'https://docs.itsm.example/problems/forbidden' });
    expect((await forbidden('webhook.manage', 'standard')).json()).toMatchObject({ type: 'https://docs.itsm.example/problems/forbidden' });
    expect(answerFor(new Error('x'), true)).toBeInstanceOf(Error);
  });

  it('logs a paused or preparing demo as a warning, not an error', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    const response = await app.inject({ method: 'GET', url: '/api/v1/unavailable' });
    expect(response.statusCode).toBe(503);
    expect(warn).toHaveBeenCalledWith('request failed', expect.objectContaining({ code: 'demo_unavailable' }));
    expect(error).not.toHaveBeenCalled();
  });
});
