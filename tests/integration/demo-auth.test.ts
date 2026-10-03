import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_FEATURES, DEMO_KEYS, DEMO_STRIPPED_PERMISSIONS, demoFeatureForPermission } from '@itsm/contracts/demo';
import { demoStatusSchema } from '@itsm/contracts/demo/schemas';
import { SYSTEM_PERMISSIONS, cache, createContext, logger, metrics, platformDb, queue, resetConfig, transaction, withContext } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { closeHarness, createTestTenant, deleteTestTenant, getApp, request, type TestTenant } from '../support/harness.js';
import { createDemoFixture, type DemoFixture } from '../support/demo-fixture.js';
import { scanKeys } from '../support/redis-keys.js';
import { signDevelopmentToken, verifyAccessToken } from '../../apps/api/src/auth/verify.js';
import { setDemoRecordReader } from '../../apps/api/src/auth/demo-token.js';

/**
 * Shared-demo authentication against real Postgres and Redis (SPEC v3 §4.4,
 * §4.6.4; A3 §11.2 rows 1–14, the status and the visitor reset).
 *
 * Tokens are minted through the BFF's real Lua store (`demo-fixture.ts`), so
 * the records the API verifies are the records production writes; forged
 * rows are written directly, as only a compromised Redis could. Every row
 * goes through the whole plugin chain with `app.inject`.
 *
 * Redis hygiene (V-M2): the fixture's BFF app name is this file's,
 * `it-demo-auth`; every key it writes is tracked and deleted in `afterAll`,
 * and the demo's singletons are restored exactly as found.
 */

const APP = 'it-demo-auth';
const STANDARD_SLUG = 'demoauth-std';

let demo: DemoFixture;
let standard: TestTenant;
let redis: Redis;

type Problem = { type?: string; reason?: string; detail?: string; status?: number };

function code(body: unknown): string | undefined {
  return (body as Problem).type?.split('/').pop();
}

function counter(name: string, labels: Record<string, string>): number {
  const key = `${name}{${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}}`;
  return metrics.snapshot().counters[key] ?? 0;
}

function systemContext(tenantId: string) {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
}

async function userCount(tenantId: string): Promise<number> {
  const ctx = systemContext(tenantId);
  return withContext(ctx, () => transaction(ctx, (tx) => tx.user.count()));
}

/** Runs `fn` with `demo:live` replaced, then puts the fixture's record back. */
async function withLive<T>(overrides: Parameters<DemoFixture['publishLive']>[0], fn: () => Promise<T>): Promise<T> {
  const generation = demo.generation;
  await demo.publishLive(overrides);
  try {
    return await fn();
  } finally {
    await demo.publishLive({ generation });
  }
}

function setMode(mode: 'on' | 'off'): void {
  vi.stubEnv('DEMO_MODE', mode);
  resetConfig();
}

beforeAll(async () => {
  vi.stubEnv('DEMO_MODE', 'on');
  vi.stubEnv('DEMO_TENANT_SLUG', 'demo');
  resetConfig();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { family: 0 });
  demo = await createDemoFixture({ slug: 'demo-it-auth', appName: APP, generation: 7, redis });
  standard = await createTestTenant(STANDARD_SLUG);
  await getApp();
}, 180_000);

afterAll(async () => {
  setDemoRecordReader(null);
  await demo?.dispose();
  await deleteTestTenant(STANDARD_SLUG);
  // V-M2: nothing under this file's BFF app name outlives it.
  expect(await scanKeys(redis, `bff:${APP}:*`)).toEqual([]);
  await redis.quit();
  await closeHarness();
  vi.unstubAllEnvs();
  resetConfig();
});

describe('A3 §11.2 rows 1–14', () => {
  it('1 · a valid demo token reads /me with the demo block and no stripped permission', async () => {
    const token = await demo.mintTestToken('admin');
    const response = await request<{ actor: { id: string }; permissions: { key: string }[]; demo: Record<string, unknown> }>('/api/v1/me', { token });
    expect(response.status).toBe(200);
    expect(response.body.actor.id).toBe(demo.personas.admin.userId);
    expect(response.body.demo).toEqual({
      persona: 'admin',
      area: 'admin',
      generation: demo.generation,
      company: 'Northwind Traders (UK)',
      disabledFeatures: [...DEMO_FEATURES],
      personaUserIds: { employee: demo.personas.employee.userId, agent: demo.personas.agent.userId, admin: demo.personas.admin.userId },
      agentTeamIds: [demo.serviceDeskTeamId],
    });
    const keys = response.body.permissions.map((permission) => permission.key);
    // Jordan administers everything a tenant can, so this is the widest set the demo can show.
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(demoFeatureForPermission(key), key).toBeNull();
    for (const key of Object.keys(DEMO_STRIPPED_PERMISSIONS)) expect(keys).not.toContain(key);

    // Every persona signs in to its own area.
    for (const persona of ['employee', 'agent'] as const) {
      const me = await request<{ demo: { persona: string } }>('/api/v1/me', { token: await demo.mintTestToken(persona) });
      expect(me.status).toBe(200);
      expect(me.body.demo.persona).toBe(persona);
    }

    // A standard session's /me has no demo block at all.
    const real = await request<Record<string, unknown>>('/api/v1/me', { token: standard.people.admin!.token });
    expect(real.status).toBe(200);
    expect(real.body).not.toHaveProperty('demo');
  });

  it('2 · a token record edited to name a standard tenant is refused before it reaches it', async () => {
    const token = await demo.forgeToken({ tenantId: standard.id, userId: standard.people.admin!.id, persona: 'agent', app: 'workbench' });
    const response = await request('/api/v1/tickets', { token });
    // The live record still names the demo, so the generation check (step 8)
    // refuses it first: the BFF would re-mint onto the live demo.
    expect(response.status).toBe(401);
    expect(code(response.body)).toBe('demo_reset');
  });

  it('3 · a fully forged Redis naming the standard tenant and its admin is refused by the kind check', async () => {
    const before = counter('demo_interlock_refusals_total', { reason: 'kind' });
    const error = vi.spyOn(logger, 'error');
    const forgedPersonas = {
      employee: { userId: standard.people.requester!.id },
      agent: { userId: standard.people.admin!.id },
      admin: { userId: standard.people.lead!.id },
    };
    const response = await withLive({ tenantId: standard.id, personas: forgedPersonas }, async () => {
      const token = await demo.forgeToken({ tenantId: standard.id, userId: standard.people.admin!.id, persona: 'agent', app: 'workbench' });
      return request('/api/v1/tickets', { token });
    });
    expect(response.status).toBe(401);
    expect(code(response.body)).toBe('unauthorised');
    expect(counter('demo_interlock_refusals_total', { reason: 'kind' })).toBe(before + 1);
    expect(error).toHaveBeenCalledWith('SECURITY: a demo token named a standard tenant', { tenantId: standard.id });
    error.mockRestore();
  });

  it('4 · the standard tenant’s administrator cannot call the demo tenant with a development token', async () => {
    const before = counter('demo_interlock_refusals_total', { reason: 'non-demo-token' });
    for (const userId of [standard.people.admin!.id, demo.personas.admin.userId]) {
      const token = signDevelopmentToken({ sub: userId, itsm_user_id: userId, tenant_id: demo.tenantId, email: 'someone@example.test' });
      const response = await request<Problem>('/api/v1/me', { token });
      expect(response.status).toBe(401);
      expect(response.body.detail).toBe('this workspace only accepts demo sessions');
    }
    expect(counter('demo_interlock_refusals_total', { reason: 'non-demo-token' })).toBe(before + 2);
  });

  it('5 · a token from before the generation advanced is answered demo_reset', async () => {
    const token = await demo.mintTestToken('agent');
    const response = await withLive({ generation: demo.generation + 1 }, () => request('/api/v1/me', { token }));
    expect(response.status).toBe(401);
    expect(code(response.body)).toBe('demo_reset');
  });

  it('6 · a demo tenant that is no longer active is answered demo_reset', async () => {
    const token = await demo.mintTestToken('agent');
    await platformDb().tenant.update({ where: { id: demo.tenantId }, data: { status: 'retired' } });
    try {
      const response = await request('/api/v1/me', { token });
      expect(response.status).toBe(401);
      expect(code(response.body)).toBe('demo_reset');
    } finally {
      await platformDb().tenant.update({ where: { id: demo.tenantId }, data: { status: 'active' } });
    }
  });

  it('7 · a purged demo tenant is answered demo_reset, by the generation check or by the interlock', async () => {
    // The usual case: the live record has moved on, so step 8 answers first.
    const token = await demo.mintTestToken('agent');
    const moved = await withLive({ generation: demo.generation + 1, tenantId: '0190f3a5-0000-7000-8000-0000000d0e1d' }, () => request('/api/v1/me', { token }));
    expect(moved.status).toBe(401);
    expect(code(moved.body)).toBe('demo_reset');

    // And a live record still naming a tenant that is gone.
    const { tenantId: goneId } = await tenantService.provisionTenant({ name: 'Purged generation', slug: 'demo-it-auth-gone', kind: 'demo' });
    await tenantService.purgeTenant(goneId);
    const gone = await withLive({ tenantId: goneId }, async () => {
      const forged = await demo.forgeToken({ tenantId: goneId, userId: demo.personas.agent.userId });
      return request('/api/v1/me', { token: forged });
    });
    expect(gone.status).toBe(401);
    expect(code(gone.body)).toBe('demo_reset');
  });

  it('8 · a record past its expiry is the end of the visit, even before its key expires', async () => {
    const now = Date.now();
    const token = await demo.forgeToken({ iat: now - 120_000, exp: now - 1_000 });
    const response = await request('/api/v1/me', { token });
    expect(response.status).toBe(401);
    expect(code(response.body)).toBe('demo_session_ended');
  });

  it('9 · a revoked token is the end of the visit', async () => {
    const token = await demo.mintTestToken('employee');
    expect((await request('/api/v1/me', { token })).status).toBe(200);
    expect(await demo.store.revoke(token)).toBe(true);
    const response = await request('/api/v1/me', { token });
    expect(response.status).toBe(401);
    expect(code(response.body)).toBe('demo_session_ended');
  });

  it('10 · a paused demo answers 503 demo_unavailable', async () => {
    const token = await demo.mintTestToken('agent');
    await redis.set(DEMO_KEYS.paused, JSON.stringify({ by: 'operator', at: Date.now(), reason: 'test' }));
    try {
      const response = await request<Problem>('/api/v1/me', { token });
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ reason: 'paused' });
      expect(code(response.body)).toBe('demo_unavailable');
    } finally {
      await redis.del(DEMO_KEYS.paused);
    }
  });

  it('11 · with the demo switched off, every demo token ends its visit', async () => {
    const tokens = await Promise.all((['employee', 'agent', 'admin'] as const).map((persona) => demo.mintTestToken(persona)));
    setMode('off');
    try {
      for (const token of tokens) {
        const response = await request('/api/v1/me', { token });
        expect(response.status).toBe(401);
        expect(code(response.body)).toBe('demo_session_ended');
      }
    } finally {
      setMode('on');
    }
  });

  it('12 · a malformed bearer is unauthorised, and nothing is ever read with it', async () => {
    const reads: string[][] = [];
    setDemoRecordReader(async (keys) => {
      reads.push([...keys]);
      return cache().mget(...keys);
    });
    try {
      const malformed = [
        `itsmdemo_${'A'.repeat(42)}`,
        `itsmdemo_${'A'.repeat(44)}`,
        `itsmdemo_${'A'.repeat(42)}*`,
        `itsmdemo_${'A'.repeat(42)}:`,
        'itsmdemo_eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl',
      ];
      for (const bearer of malformed) {
        const response = await request('/api/v1/me', { token: bearer });
        expect(response.status, bearer).toBe(401);
        expect(code(response.body)).toBe('unauthorised');
      }
      // A newline cannot travel in an HTTP header, so this one is handed to the verifier directly.
      await expect(verifyAccessToken(`Bearer itsmdemo_${'A'.repeat(21)}\n${'A'.repeat(21)}`)).rejects.toMatchObject({ status: 401, code: 'unauthorised' });
      expect(reads).toEqual([]);
    } finally {
      setDemoRecordReader(null);
    }
  });

  it('13 · a token naming a user the tenant does not have is 503 persona, and nobody is provisioned', async () => {
    const ghost = '0190f3a5-0000-7000-8000-00000000beef';
    const before = await userCount(demo.tenantId);
    const response = await withLive(
      { personas: { employee: { userId: demo.personas.employee.userId }, agent: { userId: ghost }, admin: { userId: demo.personas.admin.userId } } },
      async () => request<Problem>('/api/v1/me', { token: await demo.forgeToken({ userId: ghost }) }),
    );
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ reason: 'persona' });
    expect(await userCount(demo.tenantId)).toBe(before);
  });

  it('14 · with Redis unavailable no demo token is accepted: 503, never 200', async () => {
    const token = await demo.mintTestToken('agent');
    // The shared Redis cannot be stopped under other suites, so the verifier
    // is pointed at a client that cannot connect: the same failure, from the
    // same driver.
    const dead = new Redis({ host: '127.0.0.1', port: 1, lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null });
    setDemoRecordReader((keys) => dead.mget(...keys));
    try {
      for (const path of ['/api/v1/me', '/api/v1/tickets', '/api/demo/v1/status']) {
        const response = await request<Problem>(path, path.startsWith('/api/demo') ? {} : { token });
        expect(response.status, path).toBe(503);
        expect(response.body).toMatchObject({ reason: 'store' });
      }
    } finally {
      setDemoRecordReader(null);
      dead.disconnect();
    }
  });
});

describe('no public mint (A3 §14.1)', () => {
  it('mounts exactly two demo routes, and none of them makes a token', async () => {
    const app = await getApp();
    const listing = app.printRoutes({ commonPrefix: false });
    const demoLines = listing.split('\n').filter((line) => /demo/i.test(line));
    expect(demoLines.map((line) => line.replace(/^[\s│├└─]+/, '').trim())).toEqual(
      expect.arrayContaining(['/api/demo/v1/status (GET, HEAD)', '/api/demo/v1/reset (POST)']),
    );
    expect(demoLines).toHaveLength(2);
    expect(listing).not.toMatch(/mint|demo\/v1\/(token|session|login)/i);
  });

  it('serves the status without a token and nothing else under /api/demo', async () => {
    expect((await request('/api/demo/v1/status')).status).toBe(200);
    const reset = await request('/api/demo/v1/reset', { method: 'POST', body: { confirm: 'RESET' } });
    expect(reset.status).toBe(401);
  });
});

describe('GET /api/demo/v1/status', () => {
  it('is public, cached five seconds, strictly valid and names no tenant, user or token', async () => {
    const response = await request<Record<string, unknown>>('/api/demo/v1/status');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=5');
    expect(demoStatusSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ state: 'ready', generation: demo.generation });
    const text = JSON.stringify(response.body);
    for (const id of [demo.tenantId, demo.personas.agent.userId, demo.serviceDeskTeamId, 'itsmdemo_']) expect(text).not.toContain(id);
  });

  it('answers 404, like any unknown path, with the demo switched off', async () => {
    setMode('off');
    try {
      const response = await request<Problem>('/api/demo/v1/status');
      expect(response.status).toBe(404);
      expect(response.body.detail).toBe('no route for GET /api/demo/v1/status');
    } finally {
      setMode('on');
    }
  });
});

describe('POST /api/demo/v1/reset (§4.6.4)', () => {
  const resetKeys = [DEMO_KEYS.resetRequested, DEMO_KEYS.resetCooldown, DEMO_KEYS.resetBackoff, DEMO_KEYS.build, DEMO_KEYS.resetLock];
  const clearResetKeys = () => redis.del(...resetKeys);

  it('answers a real session 403, and an unexpected body 422', async () => {
    const real = await request<Problem>('/api/demo/v1/reset', { method: 'POST', token: standard.people.admin!.token, body: { confirm: 'RESET' } });
    expect(real.status).toBe(403);
    expect(real.body.detail).toBe('Only a demo session can reset the demo data.');
    const token = await demo.mintTestToken('admin');
    const bad = await request('/api/demo/v1/reset', { method: 'POST', token, body: { confirm: 'yes' } });
    expect(bad.status).toBe(422);
  });

  it('answers 409 while a reset is requested and 429 during the cooldown', async () => {
    const token = await demo.mintTestToken('admin');
    await clearResetKeys();
    try {
      await redis.set(DEMO_KEYS.resetRequested, JSON.stringify({ at: Date.now(), sidHash: '0'.repeat(16), generation: demo.generation }), 'EX', 300);
      const busy = await request<Problem & { state?: string }>('/api/demo/v1/reset', { method: 'POST', token, body: { confirm: 'RESET' } });
      expect(busy.status).toBe(409);
      expect(busy.body.state).toBe('building');

      await redis.del(DEMO_KEYS.resetRequested);
      await redis.set(DEMO_KEYS.resetCooldown, JSON.stringify({ at: Date.now(), generation: demo.generation, reason: 'manual' }), 'EX', 1800);
      const cooling = await request<Problem & { retryAfterSec?: number }>('/api/demo/v1/reset', { method: 'POST', token, body: { confirm: 'RESET' } });
      expect(cooling.status).toBe(429);
      expect(cooling.body.retryAfterSec).toBeGreaterThan(1790);
      expect(Number(cooling.headers['retry-after'])).toBe(cooling.body.retryAfterSec);
    } finally {
      await clearResetKeys();
    }
  });

  it('enqueues one manual build, numbered after the ledger, and audits it without an address', async () => {
    const token = await demo.mintTestToken('agent');
    const generation = demo.generation;
    const ledgerIds: string[] = [];
    await clearResetKeys();
    // Two failed manual attempts at the next generation are already ledgered.
    for (let index = 0; index < 2; index += 1) {
      const id = crypto.randomUUID();
      ledgerIds.push(id);
      await platformDb().$executeRaw`
        INSERT INTO demo_generation (id, generation, demo_tenant_id, status, reason, attempt, seed, anchor, scale, generator_version, failure)
        VALUES (${id}::uuid, ${generation + 1}, ${crypto.randomUUID()}::uuid, 'failed', 'manual', ${index + 1}, 20261002, now(), 0.2, 'it-demo-auth', '{"step":"checks"}'::jsonb)
      `;
    }
    const jobId = `demo-reset-manual-g${generation}-a3`;
    try {
      const response = await request<{ nextGeneration: number; etaSec: number }>('/api/demo/v1/reset', { method: 'POST', token, body: { confirm: 'RESET' } });
      expect(response.status).toBe(202);
      expect(response.body.nextGeneration).toBe(generation + 1);
      expect(response.body.etaSec).toBeGreaterThan(0);

      const job = await queue('demo').getJob(jobId);
      expect(job?.name).toBe('demo.reset');
      expect(job?.data).toMatchObject({ tenantId: demo.tenantId, payload: { reason: 'manual', requestedGeneration: generation } });
      expect(job?.opts).toMatchObject({ attempts: 1, removeOnComplete: true, removeOnFail: true });
      expect(await redis.exists(DEMO_KEYS.resetRequested)).toBe(1);

      // A second press, or a second visitor, is the same reset.
      const again = await request('/api/demo/v1/reset', { method: 'POST', token, body: { confirm: 'RESET' } });
      expect(again.status).toBe(409);

      const ctx = systemContext(demo.tenantId);
      const audits = await withContext(ctx, () =>
        transaction(ctx, (tx) => tx.auditEvent.findMany({ where: { action: 'demo.reset.requested' }, select: { actorId: true, ip: true, userAgent: true } })),
      );
      expect(audits).toEqual([{ actorId: demo.personas.agent.userId, ip: null, userAgent: null }]);
    } finally {
      await queue('demo').remove(jobId).catch(() => undefined);
      await clearResetKeys();
      await platformDb().$executeRaw`DELETE FROM demo_generation WHERE generator_version = 'it-demo-auth'`;
    }
  });
});

describe('event streams of an old generation (A3 §6.9)', () => {
  it('ends a demo stream when the swap is announced', async () => {
    const token = await demo.mintTestToken('agent');
    const app = await getApp();
    const opened = app.inject({ method: 'GET', url: '/api/v1/events/stream', headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' } });

    // Wait for the API's subscriber before announcing anything.
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [, subscribers] = (await redis.pubsub('NUMSUB', DEMO_KEYS.events)) as [string, number];
      if (Number(subscribers) > 0 || Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const swapped = { type: 'swapped', generation: demo.generation + 1, previousGeneration: demo.generation, previousTenantId: demo.tenantId, reason: 'manual', at: Date.now() };
    const started = Date.now();
    await redis.publish(DEMO_KEYS.events, JSON.stringify(swapped));

    const response = await Promise.race([
      opened,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('the stream did not end within 5 s')), 5_000)),
    ]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: ready');
    expect(response.body).toContain('event: demo-reset');
  });
});
