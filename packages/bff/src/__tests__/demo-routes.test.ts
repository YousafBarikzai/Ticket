import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_COPY, DEMO_KEYS, ukDateKey, type DemoLiveRecord } from '@itsm/contracts/demo';
import { demoStatusSchema } from '@itsm/contracts/demo/schemas';
import { createBff } from '../bff.js';
import { DEMO_COOKIE, SESSION_COOKIE } from '../cookies.js';
import { DEMO_STATUS_CACHE_MS, memoryLoginCounter, setLoginCounter } from '../demo/handlers.js';
import { ipBucket } from '../demo/ip.js';
import { memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import { forgetRemints } from '../demo/remint.js';
import { DEMO_SETTING_DEFAULTS } from '../demo/settings.js';
import { setDemoTokenStore, type DemoTokenStore } from '../demo/store.js';
import type { DemoSession, Session } from '../session.js';
import { setSessionStore } from '../store.js';

/**
 * The demo's status and reset routes, and the IP check (SPEC §4.5 rows
 * T1–T6; §4.6.4; §4.8; A3 §6.4, §8.1).
 *
 * The status is public — every visitor's bar and the site read it — so it
 * names no tenant, user or token, is never cached by a browser, and costs
 * one Redis read per replica per five seconds however many tabs poll. The
 * reset is the one demo write a visitor can make: only from a demo session,
 * only same-origin, forwarded to the API with the session's token, and the
 * API's answer comes back as it was. Every `it()` name starts with its row id.
 */

const ORIGIN = 'https://desk.example.test';
const API = 'http://api.internal';
const APP = {
  appName: 'workbench',
  originEnvVar: 'WORKBENCH_ORIGIN',
  defaultOrigin: ORIGIN,
  defaultLanding: '/overview',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
};
const ENV = { NODE_ENV: 'test', WORKBENCH_ORIGIN: ORIGIN, API_BASE_URL: API, DEMO_MODE: 'on' };
const TENANT_1 = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const TENANT_2 = '8a7b6c5d-4e3f-4a1b-8c9d-0e1f2a3b4c5d';
const T0 = Date.UTC(2026, 9, 3, 10, 0, 0);

function live(generation: number): DemoLiveRecord {
  const prefix = generation === 1 ? 'a1' : 'b2';
  return {
    v: 1,
    tenantId: generation === 1 ? TENANT_1 : TENANT_2,
    slug: 'demo',
    generation,
    builtAt: T0 - 3_600_000,
    anchor: T0 - 3_600_000,
    lastResetAt: T0 - 3_600_000,
    lastResetReason: 'scheduled',
    personas: {
      employee: { userId: `${prefix}000000-0000-4000-8000-000000000001` },
      agent: { userId: `${prefix}000000-0000-4000-8000-000000000002` },
      admin: { userId: `${prefix}000000-0000-4000-8000-000000000003` },
    },
    agentTeamIds: ['c3000000-0000-4000-8000-000000000001'],
  };
}

let tokens: MemoryDemoTokenStore;
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  tokens = memoryDemoTokenStore({ appName: 'workbench', clock: () => Date.now() });
  setSessionStore('workbench', tokens.sessions);
  setDemoTokenStore('workbench', tokens);
  setLoginCounter('workbench', memoryLoginCounter(tokens.keyspace));
  tokens.write(DEMO_KEYS.live, live(1));
  forgetRemints();
  upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  setSessionStore('workbench', null);
  setDemoTokenStore('workbench', null);
  setLoginCounter('workbench', null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const bffWith = (env: Record<string, string> = {}) => createBff(APP, { ...ENV, ...env });

async function usedDemoSession(): Promise<DemoSession> {
  const now = Date.now();
  const minted = await tokens.mint({ app: 'workbench', persona: 'agent', ipb: 'unknown', settings: DEMO_SETTING_DEFAULTS, now });
  if (!minted.ok) throw new Error(`mint refused: ${minted.reason}`);
  await tokens.sessions.put(
    {
      id: 'demo-1',
      kind: 'demo',
      accessToken: minted.token,
      refreshToken: null,
      accessExpiresAt: minted.record.exp,
      tenantId: minted.record.tenantId,
      userId: minted.record.userId,
      displayName: 'Alex Morgan',
      createdAt: now,
      persona: 'agent',
      demoGeneration: minted.record.gen,
      demoSid: minted.record.sid,
      lastTouchAt: now,
    },
    900,
  );
  return (await bffWith().sessionFor('demo-1')) as DemoSession;
}

function status(bff: ReturnType<typeof bffWith>): Promise<Response> {
  return bff.demoStatus(new Request(`${ORIGIN}/api/demo/status`));
}

function reset(
  bff: ReturnType<typeof bffWith>,
  cookie: string | null,
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
  body = '{"confirm":"RESET"}',
): Promise<Response> {
  return bff.demoReset(
    new Request(`${ORIGIN}/api/demo/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body,
    }),
  );
}

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('GET /api/demo/status (T1, T2)', () => {
  it('T1 is a 404 while the demo is off here', async () => {
    const response = await status(bffWith({ DEMO_MODE: 'off' }));
    expect(response.status).toBe(404);
  });

  it('T2 computes the public status from the records, uncached by any browser', async () => {
    tokens.write(DEMO_KEYS.resetCooldown, { at: T0 - 600_000, generation: 1, reason: 'scheduled' });
    const response = await status(bffWith());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(demoStatusSchema.parse(body)).toMatchObject({
      demo: true,
      state: 'ready',
      generation: 1,
      lastResetReason: 'scheduled',
      serverNow: T0,
      resetBlocked: true,
      manualResetAvailableAt: T0 - 600_000 + 1_800_000,
      uploads: false,
      company: { name: 'Northwind Traders (UK)', fictional: true },
    });
    // Public: no tenant, no user, no token anywhere in it.
    const text = JSON.stringify(body);
    for (const secret of [TENANT_1, 'a1000000-0000-4000-8000-000000000002', 'itsmdemo_']) expect(text).not.toContain(secret);
  });

  it('T2 counts the cooldown the deployment set, when it set one', async () => {
    tokens.write(DEMO_KEYS.resetCooldown, { at: T0 - 600_000, generation: 1, reason: 'manual' });
    const body = (await (await status(bffWith({ DEMO_RESET_COOLDOWN_SECONDS: '900' }))).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ cooldownSeconds: 900, manualResetAvailableAt: T0 + 300_000 });
  });

  it('T2 reads Redis once per five seconds per replica, and recomputes the clock on every call', async () => {
    const bff = bffWith();
    const read = vi.spyOn(tokens, 'readStatusRecords');
    await status(bff);
    tokens.write(DEMO_KEYS.live, live(2));
    vi.setSystemTime(T0 + DEMO_STATUS_CACHE_MS - 1);
    const cached = (await (await status(bff)).json()) as { generation: number; serverNow: number };
    expect(cached).toMatchObject({ generation: 1, serverNow: T0 + DEMO_STATUS_CACHE_MS - 1 });
    expect(read).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + DEMO_STATUS_CACHE_MS);
    await expect((await status(bff)).json()).resolves.toMatchObject({ generation: 2 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('T2 says paused, preparing and building as the records do', async () => {
    tokens.write(DEMO_KEYS.paused, { by: 'operator', at: T0, reason: 'x' });
    await expect((await status(bffWith())).json()).resolves.toMatchObject({ state: 'paused', resetBlocked: true });
  });

  it('T2 answers 503 demo_unavailable (store) when Redis cannot be read', async () => {
    setDemoTokenStore('workbench', { ...tokens, readStatusRecords: () => Promise.reject(new Error('ECONNREFUSED')) } as DemoTokenStore);
    const response = await status(bffWith());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      type: 'https://docs.itsm.example/problems/demo_unavailable',
      reason: 'store',
      detail: DEMO_COPY.unavailable,
    });
  });
});

describe('POST /api/demo/reset (T3–T6)', () => {
  it('T3 is a 404 while the demo is off here', async () => {
    const response = await reset(bffWith({ DEMO_MODE: 'off' }), null);
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', { 'sec-fetch-site': 'cross-site' }],
    ['no origin at all', {}],
  ])('T4 refuses a reset posted from %s', async (_label, headers) => {
    const session = await usedDemoSession();
    const response = await reset(bffWith(), `${SESSION_COOKIE}=${session.id}`, headers);
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('T5 refuses anything but a demo session, in the canonical words', async () => {
    const real: Session = {
      id: 'real-1',
      kind: 'oidc',
      accessToken: 'h.e30.s',
      refreshToken: 'rt',
      accessExpiresAt: Date.now() + 600_000,
      tenantId: 'standard',
      userId: 'u-1',
      displayName: 'Jane Smith',
      createdAt: Date.now(),
    };
    await tokens.sessions.put(real, 43_200);
    for (const cookie of [null, `${SESSION_COOKIE}=${real.id}`, `${SESSION_COOKIE}=nobody`]) {
      const response = await reset(bffWith(), cookie);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        type: 'https://docs.itsm.example/problems/forbidden',
        detail: 'Only a demo session can reset the demo data.',
      });
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('T6 forwards the reset to the API with the session’s token and passes 202 back as it came', async () => {
    const session = await usedDemoSession();
    upstream.mockResolvedValue(answer(202, { nextGeneration: 2, etaSec: 180 }));
    const response = await reset(bffWith(), `${SESSION_COOKIE}=${session.id}`);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ nextGeneration: 2, etaSec: 180 });

    const [url, init] = upstream.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${API}/api/demo/v1/reset`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${session.accessToken}`);
    expect(headers.get('cookie')).toBeNull();
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"confirm":"RESET"}');
  });

  it.each([
    [409, { state: 'building' }, {}],
    [429, { retryAfterSec: 1200 }, { 'retry-after': '1200' }],
    [422, { title: 'Unprocessable Entity' }, {}],
    [503, { type: 'https://docs.itsm.example/problems/demo_unavailable', reason: 'paused' }, {}],
  ])('T6 passes a %s from the API through with its body and Retry-After', async (code, body, headers) => {
    const session = await usedDemoSession();
    upstream.mockResolvedValue(answer(code, body, headers));
    const response = await reset(bffWith(), `${SESSION_COOKIE}=${session.id}`);
    expect(response.status).toBe(code);
    await expect(response.json()).resolves.toEqual(body);
    expect(response.headers.get('retry-after')).toBe((headers as Record<string, string>)['retry-after'] ?? null);
  });

  it('T6 re-mints a visit a generation behind (X2) and resends the reset once', async () => {
    const session = await usedDemoSession();
    tokens.write(DEMO_KEYS.live, live(2));
    upstream.mockImplementation(async (_url: string, init: RequestInit) => {
      const bearer = new Headers(init.headers).get('authorization');
      return bearer === `Bearer ${session.accessToken}`
        ? answer(401, { type: 'https://docs.itsm.example/problems/demo_reset', status: 401 })
        : answer(429, { retryAfterSec: 1800 }, { 'retry-after': '1800' });
    });
    const response = await reset(bffWith(), `${SESSION_COOKIE}=${session.id}`);
    // The swap's own cooldown answers the resend, as WP-31 documents.
    expect(response.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${DEMO_COOKIE}=agent.`))).toBe(true);
    await expect(tokens.sessions.get(session.id)).resolves.toMatchObject({ demoGeneration: 2 });
  });

  it('T6 answers 502 when the API cannot be reached', async () => {
    const session = await usedDemoSession();
    upstream.mockRejectedValue(new Error('ECONNREFUSED'));
    const response = await reset(bffWith(), `${SESSION_COOKIE}=${session.id}`);
    expect(response.status).toBe(502);
  });
});

describe('GET /api/demo/ip-check', () => {
  it('answers the caller’s own salted bucket and nothing else, never cached', async () => {
    const response = await bffWith().demoIpCheck(new Request(`${ORIGIN}/api/demo/ip-check`, { headers: { 'x-forwarded-for': '203.0.113.7' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['bucket']);
    expect(body.bucket).toBe(ipBucket('203.0.113.7', await tokens.daySalt(ukDateKey(Date.now()))));
    expect(JSON.stringify(body)).not.toContain('203.0.113.7');
  });

  it('tells two addresses apart, which is what the post-deploy probe compares', async () => {
    const check = async (ip: string) =>
      ((await (await bffWith().demoIpCheck(new Request(`${ORIGIN}/api/demo/ip-check`, { headers: { 'x-forwarded-for': ip } }))).json()) as { bucket: string }).bucket;
    expect(await check('203.0.113.7')).not.toBe(await check('198.51.100.9'));
  });

  it('answers in every mode, because the sign-in limiter buckets callers in every mode', async () => {
    const response = await bffWith({ DEMO_MODE: 'off' }).demoIpCheck(new Request(`${ORIGIN}/api/demo/ip-check`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ bucket: 'unknown' });
  });
});
