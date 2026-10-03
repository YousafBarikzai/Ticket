import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_CAPS, DEMO_HERO_REF_PREFIX, DEMO_KEYS, demoDisabledSentence, demoLimitSentence, demoWindow, type DemoPersonaKey } from '@itsm/contracts/demo';
import { SYSTEM_PERMISSIONS, createContext, platformDb, resetConfig, transaction, withContext, type TenantContext } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { closeHarness, createTestTenant, deleteTestTenant, getApp, request, type TestTenant } from '../support/harness.js';
import { createDemoFixture, type DemoFixture } from '../support/demo-fixture.js';
import { preserveRedisKeys, scanKeys } from '../support/redis-keys.js';
import { signDevelopmentToken } from '../../apps/api/src/auth/verify.js';
import { setDemoCounterStore } from '../../apps/api/src/plugins/demo.js';
import { DEMO_TENANT_MANAGED } from '../../apps/api/src/routes/platform.js';

/**
 * The shared demo's request policy against real Postgres and Redis (SPEC v3
 * §4.7.3, §4.7.4, §4.8, §4.11; A3 §11.2 rows 16–18 and the added rows).
 *
 * Tokens are minted through the BFF's real Lua store or forged where a test
 * needs two visits in one IP bucket; every request goes through the whole
 * plugin chain, so the budgets and caps under test are the Lua scripts in
 * Redis. Where a row needs a budget nearly spent, the counter is written
 * straight into Redis for the current window and the next one, so the row
 * holds even when it runs across a minute or an hour boundary.
 *
 * Redis hygiene (V-M2): the BFF app name is this file's, `it-demo-limits`;
 * every visit's counters, this generation's caps and the BFF keys are
 * tracked and deleted, the demo's singletons are restored by the fixture,
 * and the two tenant-wide hourly counters are put back exactly as found.
 */

const APP = 'it-demo-limits';
const GENERATION = 11;
const STANDARD_SLUG = 'demolimits-std';

let demo: DemoFixture;
let standard: TestTenant;
let redis: Redis;
let restoreTenantCounters: () => Promise<void>;

type Problem = { type?: string; detail?: string; feature?: string; category?: string; limit?: number; reason?: string; retryAfterSec?: number };

function code(body: unknown): string | undefined {
  return (body as Problem).type?.split('/').pop();
}

interface Visit {
  readonly token: string;
  readonly sid: string;
  readonly ipb: string;
}

/** Reads the visit and bucket a token's record names, and tracks every counter they key. */
async function visitOf(token: string): Promise<Visit> {
  const hash = createHash('sha256').update(token).digest('hex');
  const record = JSON.parse((await redis.get(DEMO_KEYS.token(hash))) ?? '{}') as { sid: string; ipb: string };
  demo.track([`demo:wb:${record.sid}:*`, `demo:rb:ip:${record.ipb}:*`, `demo:wb:ip:${record.ipb}:*`]);
  return { token, sid: record.sid, ipb: record.ipb };
}

async function mint(persona: DemoPersonaKey): Promise<Visit> {
  return visitOf(await demo.mintTestToken(persona));
}

/** A visit in a chosen IP bucket, as only the Lua `mint` would make one for a real visitor. */
async function forge(persona: DemoPersonaKey, ipb: string): Promise<Visit> {
  const app = persona === 'employee' ? 'portal' : persona === 'agent' ? 'workbench' : 'admin';
  return visitOf(await demo.forgeToken({ persona, app, userId: demo.personas[persona].userId, ipb }));
}

function bucket(): string {
  return randomBytes(8).toString('hex');
}

/** Writes a counter for the window `now` falls in and the next one. */
async function seedWindows(build: (at: number) => string, unit: 'm' | 'h', value: number): Promise<void> {
  const length = unit === 'm' ? 60_000 : 3_600_000;
  const now = Date.now();
  for (const at of [now, now + length]) {
    const key = build(at);
    demo.track([key]);
    await redis.set(key, String(value), 'EX', unit === 'm' ? 120 : 7200);
  }
}

/** One cheap, real write: marks the visitor's notifications read. */
function write(visit: Visit) {
  return request<Problem>('/api/v1/notifications/all/read', { method: 'POST', token: visit.token, body: {} });
}

function hourKeys(): string[] {
  const now = Date.now();
  return [now, now + 3_600_000].flatMap((at) => [DEMO_KEYS.writesAll(demoWindow('h', at)), DEMO_KEYS.writesTop(demoWindow('h', at))]);
}

beforeAll(async () => {
  vi.stubEnv('DEMO_MODE', 'on');
  vi.stubEnv('DEMO_TENANT_SLUG', 'demo');
  resetConfig();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { family: 0 });
  restoreTenantCounters = await preserveRedisKeys(redis, hourKeys());
  demo = await createDemoFixture({ slug: 'demo-it-limits', appName: APP, generation: GENERATION, redis, tickets: 3 });
  demo.track([`demo:cap:${GENERATION}:*`]);
  standard = await createTestTenant(STANDARD_SLUG);
  await getApp();
}, 180_000);

afterAll(async () => {
  setDemoCounterStore(null);
  await restoreTenantCounters?.();
  await demo?.dispose();
  await deleteTestTenant(STANDARD_SLUG);
  // V-M2: nothing under this file's BFF app name outlives it, and none of its visits' counters.
  expect(await scanKeys(redis, `bff:${APP}:*`)).toEqual([]);
  expect(await scanKeys(redis, `demo:cap:${GENERATION}:*`)).toEqual([]);
  await redis.quit();
  await closeHarness();
  vi.unstubAllEnvs();
  resetConfig();
});

describe('A3 §11.2 row 16 · the shared personas are protected', () => {
  it('refuses deactivating a persona, changing roles and revoking a session; lists no sessions; acknowledges a session record', async () => {
    const jordan = await mint('admin');
    for (const persona of ['employee', 'agent', 'admin'] as const) {
      const response = await request<Problem>(`/api/v1/users/${demo.personas[persona].userId}/deactivate`, { method: 'POST', token: jordan.token, body: {} });
      expect(response.status, persona).toBe(403);
      expect(code(response.body)).toBe('demo_disabled');
      expect(response.body.feature).toBe('personas');
      expect(response.body.detail).toBe(demoDisabledSentence('personas'));
    }
    const role = await request<Problem>('/api/v1/role-assignments', {
      method: 'POST',
      token: jordan.token,
      body: { userId: demo.personas.employee.userId, roleKey: 'administrator' },
    });
    expect(role.status).toBe(403);
    expect(role.body.feature).toBe('roles');

    const revoke = await request<Problem>(`/api/v1/me/sessions/${randomUUID()}`, { method: 'DELETE', token: jordan.token });
    expect(revoke.status).toBe(403);
    expect(revoke.body.feature).toBe('sessions');
    const sessions = await request('/api/v1/me/sessions', { token: jordan.token });
    expect(sessions.status).toBe(200);
    expect(sessions.body).toEqual({ data: [] });
    const recorded = await request('/api/v1/auth/session', { method: 'POST', token: jordan.token, body: {} });
    expect(recorded.status).toBe(204);

    // Every persona is still active, with its roles.
    const ctx = createContext({ tenantId: demo.tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    const users = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.user.findMany({ where: { id: { in: Object.values(demo.personas).map((person) => person.userId) } }, select: { status: true } })),
    );
    expect(users.map((user) => user.status)).toEqual(['active', 'active', 'active']);
    const me = await request<{ demo: { persona: string } }>('/api/v1/me', { token: (await mint('employee')).token });
    expect(me.status).toBe(200);
  });
});

describe('A3 §11.2 row 17 · caps (§4.7.4)', () => {
  const declare = (visit: Visit, title = 'Payroll export failing for every site') =>
    request<Problem & { number?: string }>('/api/v1/major-incidents', {
      method: 'POST',
      token: visit.token,
      body: { title, severity: 'SEV2', commanderId: demo.personas.admin.userId },
    });

  it('allows one major incident per visit; a failed request gives the cap back', async () => {
    const jordan = await mint('admin');
    const capKey = DEMO_KEYS.capPerVisit(GENERATION, 'mi.declare', jordan.sid);

    const invalid = await request<Problem>('/api/v1/major-incidents', { method: 'POST', token: jordan.token, body: { title: '' } });
    expect(invalid.status).toBe(422);
    expect(Number((await redis.get(capKey)) ?? '0')).toBe(0);

    const first = await declare(jordan);
    expect(first.status).toBe(201);
    expect(await redis.get(capKey)).toBe('1');
    expect(await redis.pttl(capKey)).toBeGreaterThan(89_000_000);

    const second = await declare(jordan, 'A second outage, the same visit');
    expect(second.status).toBe(429);
    expect(code(second.body)).toBe('demo_limit');
    expect(second.body).toMatchObject({ category: 'mi.declare', limit: DEMO_CAPS['mi.declare'].perVisit });
    expect(second.body.detail).toBe(demoLimitSentence('mi.declare'));
  });

  it('allows ten per generation across every visit', async () => {
    const generationKey = DEMO_KEYS.capAll(GENERATION, 'mi.declare');
    await redis.set(generationKey, String(DEMO_CAPS['mi.declare'].perGeneration), 'EX', 90_000);
    const fresh = await mint('admin');
    const refused = await declare(fresh);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ category: 'mi.declare' });
    // Refused before it was counted: nothing to give back, nothing taken.
    expect(await redis.get(generationKey)).toBe(String(DEMO_CAPS['mi.declare'].perGeneration));
    expect(Number((await redis.get(DEMO_KEYS.capPerVisit(GENERATION, 'mi.declare', fresh.sid))) ?? '0')).toBe(0);
  });
});

describe('A3 §11.2 row 18 · write and read budgets (§4.8)', () => {
  it('counts each write once, per visit and per bucket, in Redis', async () => {
    const visit = await mint('agent');
    for (let i = 0; i < 3; i += 1) expect((await write(visit)).status).toBe(200);
    expect(await redis.get(DEMO_KEYS.writesPerVisitTotal(visit.sid))).toBe('3');
    const now = Date.now();
    const perMinute = await Promise.all([now - 60_000, now].map((at) => redis.get(DEMO_KEYS.writesPerVisit(visit.sid, demoWindow('m', at)))));
    expect(perMinute.reduce((sum, value) => sum + Number(value ?? 0), 0)).toBe(3);
    expect(await redis.pttl(DEMO_KEYS.writesPerVisitTotal(visit.sid))).toBeGreaterThan(86_000_000);
  });

  it('refuses the 31st write in a minute with 429 rate_limited and Retry-After', async () => {
    const visit = await mint('agent');
    await seedWindows((at) => DEMO_KEYS.writesPerVisit(visit.sid, demoWindow('m', at)), 'm', 30);
    const refused = await write(visit);
    expect(refused.status).toBe(429);
    expect(code(refused.body)).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    // A refused write is not counted against the visit's total.
    expect(await redis.get(DEMO_KEYS.writesPerVisitTotal(visit.sid))).toBeNull();
    // A read-like POST is not a write (Y-M3).
    const query = await request('/api/v1/analytics/query', { method: 'POST', token: (await forge('admin', visit.ipb)).token, body: { metricKey: 'tickets.created' } });
    expect(query.status).toBe(200);
  });

  it('refuses the 501st write of a visit with 429 demo_limit "writes"', async () => {
    const visit = await mint('agent');
    await redis.set(DEMO_KEYS.writesPerVisitTotal(visit.sid), '500', 'EX', 86_400);
    const refused = await write(visit);
    expect(refused.status).toBe(429);
    expect(code(refused.body)).toBe('demo_limit');
    expect(refused.body).toMatchObject({ category: 'writes', limit: 500 });
    expect(refused.body.detail).toBe(demoLimitSentence('writes', { limit: 500 }));
    expect(refused.headers['retry-after']).toBeUndefined();
  });

  it('refuses the 2,001st write in an hour across two visits from one bucket', async () => {
    const ipb = bucket();
    const first = await forge('agent', ipb);
    const second = await forge('agent', ipb);
    await seedWindows((at) => DEMO_KEYS.writesPerBucket(ipb, demoWindow('h', at)), 'h', 1_999);
    expect((await write(first)).status).toBe(200);
    const refused = await write(second);
    expect(refused.status).toBe(429);
    expect(code(refused.body)).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(3_600);
    // Another bucket writes on.
    expect((await write(await mint('agent'))).status).toBe(200);
  });

  it('above the alert level refuses only the ten busiest buckets, never everybody (Y-M1)', async () => {
    const busiest = bucket();
    const quiet = bucket();
    // The two tenant-wide counters are shared with every other demo visit;
    // this row puts them back as it found them.
    const restore = await preserveRedisKeys(redis, hourKeys());
    try {
      // The alert level (DEMO_WRITES_ALERT_PER_HOUR, 20,000) is reached, and
      // `busiest` leads the hour; nine other buckets follow it.
      for (const at of [Date.now(), Date.now() + 3_600_000]) {
        const hour = demoWindow('h', at);
        await redis.set(DEMO_KEYS.writesAll(hour), '20000', 'EX', 7200);
        const members: (string | number)[] = [500, busiest];
        for (let i = 0; i < 9; i += 1) members.push(400 - i, bucket());
        await redis.zadd(DEMO_KEYS.writesTop(hour), ...members);
        await redis.expire(DEMO_KEYS.writesTop(hour), 7200);
      }
      const refused = await write(await forge('agent', busiest));
      expect(refused.status).toBe(429);
      expect(code(refused.body)).toBe('rate_limited');
      const allowed = await write(await forge('agent', quiet));
      expect(allowed.status).toBe(200);
      expect(await redis.zscore(DEMO_KEYS.writesTop(demoWindow('h', Date.now())), quiet)).not.toBeNull();
    } finally {
      await restore();
    }
  });

  it('refuses a bucket’s reads after 1,200 a minute with 429 rate_limited, and only that bucket’s (Y-M2)', async () => {
    const visit = await mint('employee');
    await seedWindows((at) => DEMO_KEYS.readsPerBucket(visit.ipb, demoWindow('m', at)), 'm', 1_200);
    const refused = await request<Problem>('/api/v1/me', { token: visit.token });
    expect(refused.status).toBe(429);
    expect(code(refused.body)).toBe('rate_limited');
    expect((await request('/api/v1/me', { token: (await mint('employee')).token })).status).toBe(200);
  });

  it('fails closed: with the counters unavailable a demo request is 503 demo_unavailable "store", never served', async () => {
    const visit = await mint('agent');
    setDemoCounterStore({
      spend: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      },
      takeCap: async () => ({ ok: true }),
      giveBackCap: async () => undefined,
    });
    try {
      for (const response of [await request<Problem>('/api/v1/me', { token: visit.token }), await write(visit)]) {
        expect(response.status).toBe(503);
        expect(code(response.body)).toBe('demo_unavailable');
        expect(response.body.reason).toBe('store');
      }
    } finally {
      setDemoCounterStore(null);
    }
    expect((await request('/api/v1/me', { token: visit.token })).status).toBe(200);
  });
});

describe('locked settings (Y-M12)', () => {
  it('refuses a setting in DEMO_LOCKED_SETTINGS and leaves its value; caps the others at five a visit', async () => {
    const jordan = await mint('admin');
    const before = await request<{ value: unknown }>('/api/v1/settings/sla.attainment.target', { token: jordan.token });
    expect(before.status).toBe(200);
    for (const [method, url, body] of [
      ['PUT', '/api/v1/settings/sla.attainment.target', { value: 50 }],
      ['POST', '/api/v1/settings/sla.attainment.target/rollback', { toVersion: 1 }],
      ['PUT', '/api/v1/settings/ticket.autoClose.days', { value: 1 }],
    ] as const) {
      const response = await request<Problem>(url, { method, token: jordan.token, body });
      expect(response.status, url).toBe(403);
      expect(code(response.body)).toBe('demo_disabled');
      expect(response.body.feature).toBe('settings');
      expect(response.body.detail).toBe(demoDisabledSentence('settings'));
    }
    const after = await request<{ value: unknown }>('/api/v1/settings/sla.attainment.target', { token: jordan.token });
    expect(after.body.value).toEqual(before.body.value);

    for (let i = 0; i < DEMO_CAPS['setting.change'].perVisit; i += 1) {
      const response = await request('/api/v1/settings/assets.warrantyWarningDays', { method: 'PUT', token: jordan.token, body: { value: 40 + i } });
      expect(response.status).toBe(200);
    }
    const capped = await request<Problem>('/api/v1/settings/assets.warrantyWarningDays', { method: 'PUT', token: jordan.token, body: { value: 60 } });
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({ category: 'setting.change', limit: 5 });
  });
});

describe('hero tickets (Y-m5)', () => {
  let hero: { id: string; number: string };

  beforeAll(async () => {
    const base = createContext({ tenantId: demo.tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS, organisationIds: [demo.orgId] });
    const requester: TenantContext = { ...base, actor: { type: 'user', id: demo.personas.employee.userId, displayName: 'Emma Clarke' } };
    const ticket = await withContext(requester, () =>
      ticketService.createTicket(requester, {
        type: 'incident',
        title: 'Finance share is read-only for the month-end close',
        description: 'Since this morning nobody in Finance can save to the share.',
        priority: 'P2',
        requesterId: demo.personas.employee.userId,
        groupId: demo.serviceDeskTeamId,
        orgId: demo.orgId,
        sourceChannel: 'portal',
        externalRef: `${DEMO_HERO_REF_PREFIX}H1`,
      }),
    );
    hero = { id: ticket.id, number: ticket.number };
  });

  it('refuses a change to the title or the description as "story"; status, priority and replies stay open', async () => {
    const alex = await mint('agent');
    const read = await request<{ title: string; version: number }>(`/api/v1/tickets/${hero.number}`, { token: alex.token });
    expect(read.status).toBe(200);

    const title = await request<Problem>(`/api/v1/tickets/${hero.number}`, {
      method: 'PATCH',
      token: alex.token,
      body: { title: 'Nothing to see here' },
      headers: { 'if-match': `"${read.body.version}"` },
    });
    expect(title.status).toBe(403);
    expect(code(title.body)).toBe('demo_disabled');
    expect(title.body.feature).toBe('story');
    expect(title.body.detail).toBe(demoDisabledSentence('story'));
    const description = await request<Problem>(`/api/v1/tickets/${hero.id}`, {
      method: 'PATCH',
      token: alex.token,
      body: { description: 'gone' },
      headers: { 'if-match': `"${read.body.version}"` },
    });
    expect(description.body.feature).toBe('story');

    const priority = await request<{ priority: string; title: string; version: number }>(`/api/v1/tickets/${hero.number}`, {
      method: 'PATCH',
      token: alex.token,
      body: { priority: 'P1', title: read.body.title },
      headers: { 'if-match': `"${read.body.version}"` },
    });
    expect(priority.status).toBe(200);
    expect(priority.body.priority).toBe('P1');
    expect(priority.body.title).toBe('Finance share is read-only for the month-end close');

    const moved = await request<{ status: string }>(`/api/v1/tickets/${hero.number}/transitions`, { method: 'POST', token: alex.token, body: { to: 'in_progress' } });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('in_progress');
    const reply = await request(`/api/v1/tickets/${hero.number}/comments`, { method: 'POST', token: alex.token, body: { body: 'Looking at the share permissions now.', visibility: 'public' } });
    expect(reply.status).toBeLessThan(300);
  });

  it('leaves an ordinary ticket’s title to the visitor', async () => {
    const alex = await mint('agent');
    const number = demo.ticketNumbers[0]!;
    const read = await request<{ version: number }>(`/api/v1/tickets/${number}`, { token: alex.token });
    const renamed = await request<{ title: string }>(`/api/v1/tickets/${number}`, {
      method: 'PATCH',
      token: alex.token,
      body: { title: 'Outlook keeps asking for my password on the laptop' },
      headers: { 'if-match': `"${read.body.version}"` },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Outlook keeps asking for my password on the laptop');
  });
});

describe('the seeded shared dashboards (A3 §7.5)', () => {
  it('refuses a change to a seeded dashboard as "shared-dashboards" and gives the cap back; a visitor’s own is theirs', async () => {
    const jordan = await mint('admin');
    const list = await request<{ data: { id: string; seeded: boolean; personal: boolean }[] }>('/api/v1/analytics/dashboards', { token: jordan.token });
    const seeded = list.body.data.find((row) => row.seeded);
    expect(seeded, 'provisioning seeds the shared dashboards').toBeDefined();

    for (const method of ['PATCH', 'DELETE'] as const) {
      const response = await request<Problem>(`/api/v1/analytics/dashboards/${seeded!.id}`, { method, token: jordan.token, body: method === 'PATCH' ? { name: 'Mine now' } : undefined });
      expect(response.status, method).toBe(403);
      expect(code(response.body)).toBe('demo_disabled');
      expect(response.body.feature).toBe('shared-dashboards');
    }
    expect(Number((await redis.get(DEMO_KEYS.capPerVisit(GENERATION, 'dashboard.change', jordan.sid))) ?? '0')).toBe(0);

    const made = await request<{ id: string }>('/api/v1/analytics/dashboards', { method: 'POST', token: jordan.token, body: { name: 'My week', personal: true } });
    expect(made.status).toBe(201);
    const renamed = await request<{ name: string }>(`/api/v1/analytics/dashboards/${made.body.id}`, { method: 'PATCH', token: jordan.token, body: { name: 'My fortnight' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('My fortnight');
  });
});

describe('the operator guard (Y-M13)', () => {
  function operator(): string {
    return signDevelopmentToken({ sub: 'platform-operator-it', tenant_id: standard.id, typ: 'service', scope: 'platform.tenant.manage platform.plan.manage' });
  }

  it('answers 409 for every lifecycle and plan change to a demo tenant, which stays as it was', async () => {
    const token = operator();
    for (const [method, path, body] of [
      ['POST', `/api/platform/v1/tenants/${demo.tenantId}/suspend`, { reason: 'tidying up' }],
      ['POST', `/api/platform/v1/tenants/${demo.tenantId}/resume`, {}],
      ['PUT', `/api/platform/v1/tenants/${demo.tenantId}/plan`, { planKey: 'starter' }],
      ['PUT', `/api/platform/v1/tenants/${demo.tenantId}/ai-regions`, { regions: ['us-east'] }],
    ] as const) {
      const response = await request<Problem>(path, { method, token, body });
      expect(response.status, path).toBe(409);
      expect(response.body.detail).toBe(DEMO_TENANT_MANAGED);
    }
    const tenant = await platformDb().tenant.findUnique({ where: { id: demo.tenantId }, select: { status: true, aiAllowedRegions: true } });
    expect(tenant).toEqual({ status: 'active', aiAllowedRegions: [] });
    // Visitors carry on.
    expect((await request('/api/v1/me', { token: (await mint('agent')).token })).status).toBe(200);
  });

  it('never provisions a demo tenant by hand, and leaves a standard tenant to the operator', async () => {
    const token = operator();
    const refused = await request<{ errors?: { field: string }[] }>('/api/platform/v1/tenants', { method: 'POST', token, body: { name: 'By hand', slug: 'demo-by-hand', kind: 'demo' } });
    expect(refused.status).toBe(422);
    expect(refused.body.errors?.[0]?.field).toBe('kind');
    expect(await platformDb().tenant.findFirst({ where: { slug: 'demo-by-hand' } })).toBeNull();

    const regions = await request(`/api/platform/v1/tenants/${standard.id}/ai-regions`, { method: 'PUT', token, body: { regions: [] } });
    expect(regions.status).toBe(200);
  });
});

describe('a standard tenant is untouched by every rule', () => {
  it('writes and reads with no demo counter, cap or refusal', async () => {
    const before = new Set([...(await scanKeys(redis, 'demo:wb:*')), ...(await scanKeys(redis, 'demo:rb:*')), ...(await scanKeys(redis, 'demo:cap:*'))]);
    const admin = standard.people.admin!.token;
    for (let i = 0; i < 2; i += 1) {
      const declared = await request('/api/v1/major-incidents', {
        method: 'POST',
        token: admin,
        body: { title: `Standard outage ${i}`, severity: 'SEV3', commanderId: standard.people.admin!.id },
      });
      expect(declared.status).toBe(201);
    }
    const locked = await request('/api/v1/settings/sla.attainment.target', { method: 'PUT', token: admin, body: { value: 92 } });
    expect(locked.status).toBe(200);
    expect((await request('/api/v1/me/sessions', { token: admin })).status).toBe(200);
    const after = new Set([...(await scanKeys(redis, 'demo:wb:*')), ...(await scanKeys(redis, 'demo:rb:*')), ...(await scanKeys(redis, 'demo:cap:*'))]);
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
  });
});
