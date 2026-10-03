import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_KEYS, demoWindow, type DemoLiveRecord } from '@itsm/contracts/demo';
import { createBff } from '../bff.js';
import { memoryLoginCounter, setLoginCounter } from '../demo/handlers.js';
import { memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import { forgetRemints, LATEST_SESSION_MS, remintOnce } from '../demo/remint.js';
import { DEMO_SETTING_DEFAULTS } from '../demo/settings.js';
import { demoTokenHash, sessionRecordKey, setDemoTokenStore, type DemoTokenStore } from '../demo/store.js';
import type { DemoSession, Session } from '../session.js';
import { setSessionStore } from '../store.js';

/**
 * `sessionFor` (SPEC §4.5 rows F1–F9; A3 §5.3): the session behind a cookie,
 * as every page, the proxy and the route handlers read it.
 *
 * F2–F5 are the provider and development rows as they were before sessions
 * had a kind. F6–F9 are the demo's: a demo session is never refreshed through
 * the provider and never recorded with the API; its token is re-minted
 * instead — on the first page after the mint, which slides a fifteen-minute
 * first life to the full four hours (Y-B1), and again at half-life — and its
 * last use is touched at most once per five minutes. A visit that ends by
 * itself hands back the real session it put aside, when that is still live
 * (Y-m3). Every `it()` name starts with its row id.
 */

const ORIGIN = 'https://desk.example.test';
const API = 'http://api.internal';
const ISSUER = 'https://id.example.test/realms/session-for';
const APP = {
  appName: 'workbench',
  originEnvVar: 'WORKBENCH_ORIGIN',
  defaultOrigin: ORIGIN,
  defaultLanding: '/overview',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
};
const ENV = { NODE_ENV: 'test', WORKBENCH_ORIGIN: ORIGIN, API_BASE_URL: API, DEMO_MODE: 'on' };
const OIDC = { OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'workbench', OIDC_CLIENT_SECRET: 'shhh' };

const TENANT = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const AGENT = 'a1000000-0000-4000-8000-000000000002';
const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 3, 9, 0, 0);

function live(generation = 1): DemoLiveRecord {
  return {
    v: 1,
    tenantId: TENANT,
    slug: 'demo',
    generation,
    builtAt: T0,
    anchor: T0,
    lastResetAt: T0,
    lastResetReason: 'scheduled',
    personas: {
      employee: { userId: 'a1000000-0000-4000-8000-000000000001' },
      agent: { userId: AGENT },
      admin: { userId: 'a1000000-0000-4000-8000-000000000003' },
    },
    agentTeamIds: [],
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
  upstream = vi.fn(async () => new Response('{}', { status: 404 }));
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

function bffWith(env: Record<string, string> = {}) {
  return createBff(APP, { ...ENV, ...env });
}

/** A freshly minted demo session, stored as the sign-in stores it. */
async function demoSession(overrides: Partial<Session> = {}, id = 'demo-session-1'): Promise<DemoSession> {
  const now = Date.now();
  const minted = await tokens.mint({ app: 'workbench', persona: 'agent', ipb: 'unknown', settings: DEMO_SETTING_DEFAULTS, now });
  if (!minted.ok) throw new Error(`mint refused: ${minted.reason}`);
  const session = {
    id,
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
    ...overrides,
  } as DemoSession;
  await tokens.sessions.put(session, Math.ceil((session.accessExpiresAt - now) / 1000));
  return session;
}

async function realSession(overrides: Partial<Session> = {}, id = 'real-session-1'): Promise<Session> {
  const session: Session = {
    id,
    kind: 'oidc',
    accessToken: 'h.e30.s',
    refreshToken: 'rt-1',
    accessExpiresAt: Date.now() + 10 * MINUTE,
    tenantId: 'standard-tenant',
    userId: 'u-1',
    displayName: 'Jane Smith',
    createdAt: Date.now(),
    ...overrides,
  };
  await tokens.sessions.put(session, 43_200);
  return session;
}

function tokenExists(token: string): boolean {
  return tokens.keyspace.exists(DEMO_KEYS.token(demoTokenHash(token)));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The provider, routed by URL: discovery, the token endpoint (as given), and the API's session record. */
function provider(token: () => Response): void {
  upstream.mockImplementation(async (input: string) => {
    const url = String(input);
    if (url.includes('.well-known')) return json({ authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token` });
    if (url === `${ISSUER}/token`) return token();
    if (url.endsWith('/api/v1/auth/session')) return json({ id: 's', expiresAt: '', lastSeenAt: '' }, 201);
    return json({}, 404);
  });
}

const claims = (body: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(body)).toString('base64url')}.s`;

describe('sessionFor (F rows)', () => {
  it('F1 finds no session without a cookie, for an id that names nothing, or for a record that does not decode', async () => {
    const bff = bffWith();
    await expect(bff.sessionFor(undefined)).resolves.toBeNull();
    await expect(bff.sessionFor('')).resolves.toBeNull();
    await expect(bff.sessionFor('nobody')).resolves.toBeNull();
    tokens.write(sessionRecordKey('workbench', 'broken'), '{"id":"broken","kind":"demo","accessToken":"x"}');
    await expect(bff.sessionFor('broken')).resolves.toBeNull();
  });

  it('F2 hands back a provider session that is not close to expiring, untouched', async () => {
    const real = await realSession();
    await expect(bffWith(OIDC).sessionFor(real.id)).resolves.toEqual(real);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('F3 refreshes a provider session close to expiring, and records it with the API', async () => {
    const real = await realSession({ accessExpiresAt: Date.now() + 30_000 });
    const fresh = claims({ tenant_id: 'standard-tenant', name: 'Jane Smith' });
    provider(() => json({ access_token: fresh, refresh_token: 'rt-2', expires_in: 300 }));
    const refreshed = await bffWith(OIDC).sessionFor(real.id);
    expect(refreshed).toMatchObject({ id: real.id, kind: 'oidc', accessToken: fresh, refreshToken: 'rt-2' });
    expect(upstream.mock.calls.some((call) => String(call[0]).endsWith('/api/v1/auth/session'))).toBe(true);
  });

  it('F4 drops a provider session whose refresh is refused, or that has no provider to refresh against', async () => {
    const refused = await realSession({ accessExpiresAt: Date.now() + 30_000 });
    provider(() => json({ error: 'invalid_grant' }, 400));
    await expect(bffWith(OIDC).sessionFor(refused.id)).resolves.toBeNull();
    await expect(tokens.sessions.get(refused.id)).resolves.toBeNull();

    const orphan = await realSession({ accessExpiresAt: Date.now() + 30_000 }, 'real-session-2');
    await expect(bffWith().sessionFor(orphan.id)).resolves.toBeNull();
  });

  it('F5 drops a development session close to expiring: there is nothing to refresh it with', async () => {
    const dev = await realSession({ kind: 'dev', refreshToken: null, accessExpiresAt: Date.now() + 30_000 });
    await expect(bffWith(OIDC).sessionFor(dev.id)).resolves.toBeNull();
    await expect(tokens.sessions.get(dev.id)).resolves.toBeNull();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('F6 ends a demo session once the demo is switched off here: the token is revoked and the record goes', async () => {
    const session = await demoSession();
    await expect(bffWith({ DEMO_MODE: 'off' }).sessionFor(session.id)).resolves.toBeNull();
    expect(tokenExists(session.accessToken)).toBe(false);
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
  });

  it('F6 hands back the real session the demo put aside, under the same cookie', async () => {
    const real = await realSession();
    const session = await demoSession({ parkedSessionId: real.id });
    const restored = await bffWith({ DEMO_MODE: 'off' }).sessionFor(session.id);
    expect(restored).toMatchObject({ id: session.id, kind: 'oidc', displayName: 'Jane Smith', accessToken: real.accessToken });
    // One session, one record: the parked id is gone, the cookie's id holds it.
    await expect(tokens.sessions.get(real.id)).resolves.toBeNull();
    await expect(tokens.sessions.get(session.id)).resolves.toMatchObject({ kind: 'oidc' });
    expect(tokenExists(session.accessToken)).toBe(false);
  });

  it('F7 ends a visit older than a day, and its parked session is past giving back by then', async () => {
    const real = await realSession();
    const session = await demoSession({ parkedSessionId: real.id, createdAt: Date.now() - 86_400_000 });
    await expect(bffWith().sessionFor(session.id)).resolves.toBeNull();
    expect(tokenExists(session.accessToken)).toBe(false);
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
  });

  it('F8 slides a token on its first life to the full four hours on the first page render', async () => {
    const session = await demoSession();
    vi.setSystemTime(T0 + 5_000);
    const slid = await bffWith().sessionFor(session.id);
    expect(slid).toMatchObject({ id: session.id, kind: 'demo', demoSid: session.demoSid, demoGeneration: 1 });
    expect(slid!.accessToken).not.toBe(session.accessToken);
    expect(slid!.accessExpiresAt).toBe(T0 + 5_000 + 14_400_000);
    expect(tokenExists(session.accessToken)).toBe(false);
    expect(tokenExists(slid!.accessToken)).toBe(true);
    // Read again, it is not slid twice.
    await expect(bffWith().sessionFor(session.id)).resolves.toMatchObject({ accessToken: slid!.accessToken });
  });

  it('F8 slides again at half-life, onto the live generation', async () => {
    const session = await demoSession();
    const bff = bffWith();
    const slid = (await bff.sessionFor(session.id))!;
    vi.setSystemTime(T0 + 2 * 60 * MINUTE + MINUTE);
    tokens.write(DEMO_KEYS.live, live(2));
    const again = (await bff.sessionFor(session.id))!;
    expect(again.accessToken).not.toBe(slid.accessToken);
    expect(again.demoGeneration).toBe(2);
    expect(again.accessExpiresAt).toBe(Date.now() + 14_400_000);
  });

  it('F8 keeps a session with more than a minute left when its re-mint is refused', async () => {
    const session = await demoSession();
    tokens.write(DEMO_KEYS.paused, { by: 'operator', at: Date.now(), reason: 'maintenance' });
    await expect(bffWith().sessionFor(session.id)).resolves.toMatchObject({ accessToken: session.accessToken });
    expect(tokenExists(session.accessToken)).toBe(true);
  });

  it('F8 ends a session with under a minute left when its re-mint is refused', async () => {
    const session = await demoSession();
    tokens.write(DEMO_KEYS.paused, { by: 'operator', at: Date.now(), reason: 'maintenance' });
    vi.setSystemTime(session.accessExpiresAt - 30_000);
    await expect(bffWith().sessionFor(session.id)).resolves.toBeNull();
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
  });

  it('F8 ends a visit whose token is gone (evicted, expired or revoked), whatever time is left', async () => {
    const session = await demoSession();
    await tokens.revoke(session.accessToken);
    await expect(bffWith().sessionFor(session.id)).resolves.toBeNull();
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
  });

  it('F8 keeps a session with time left when the store cannot be reached for the re-mint', async () => {
    const session = await demoSession();
    setDemoTokenStore('workbench', { ...tokens, remint: () => Promise.reject(new Error('ECONNREFUSED')) } as DemoTokenStore);
    await expect(bffWith().sessionFor(session.id)).resolves.toMatchObject({ accessToken: session.accessToken });
  });

  it('F8 re-mints once however many readers ask at the same moment', async () => {
    const session = await demoSession();
    const bff = bffWith();
    const remint = vi.spyOn(tokens, 'remint');
    setDemoTokenStore('workbench', tokens);
    const read = await Promise.all([bff.sessionFor(session.id), bff.sessionFor(session.id), bff.sessionFor(session.id)]);
    expect(new Set(read.map((s) => s?.accessToken)).size).toBe(1);
    expect(remint.mock.calls.length).toBeLessThanOrEqual(1);
    expect(tokens.keyspace.get(DEMO_KEYS.remint(session.demoSid, demoWindow('h', Date.now())))).toBe('1');

    // The flight itself: two callers with the same (session, token) share one promise.
    const second = await demoSession({}, 'demo-session-2');
    const a = remintOnce({ appName: 'workbench', store: tokens, session: second, settings: DEMO_SETTING_DEFAULTS, cause: 'slide' });
    const b = remintOnce({ appName: 'workbench', store: tokens, session: second, settings: DEMO_SETTING_DEFAULTS, cause: 'slide' });
    expect(a).toBe(b);
    await a;
  });

  it('F9 hands back a used session as it is, and never refreshes or records it', async () => {
    const session = await demoSession();
    const bff = bffWith(OIDC);
    const slid = (await bff.sessionFor(session.id))!;
    vi.setSystemTime(T0 + MINUTE);
    await expect(bff.sessionFor(session.id)).resolves.toMatchObject({ accessToken: slid.accessToken });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('F9 touches the token’s last use at most once every five minutes', async () => {
    const session = await demoSession();
    const bff = bffWith();
    const slid = (await bff.sessionFor(session.id))!;
    const hash = demoTokenHash(slid.accessToken);
    const score = () => tokens.keyspace.zscore(DEMO_KEYS.active, hash);
    const touchedAt = score();

    vi.setSystemTime(T0 + 4 * MINUTE);
    await bff.sessionFor(session.id);
    expect(score()).toBe(touchedAt);

    vi.setSystemTime(T0 + 5 * MINUTE + 1_000);
    await bff.sessionFor(session.id);
    expect(score()).toBe(T0 + 5 * MINUTE + 1_000);
    await expect(tokens.sessions.get(session.id)).resolves.toMatchObject({ lastTouchAt: T0 + 5 * MINUTE + 1_000 });

    vi.setSystemTime(T0 + 6 * MINUTE);
    await bff.sessionFor(session.id);
    expect(score()).toBe(T0 + 5 * MINUTE + 1_000);
  });
});

describe('latestSession', () => {
  it('follows a re-mint for ten seconds, so a layout hands the bar the generation the page reads', async () => {
    const session = await demoSession();
    const bff = bffWith();
    const slid = (await bff.sessionFor(session.id))!;
    expect(bff.latestSession(session)).toEqual(slid);
    expect(bff.latestSession(slid)).toBe(slid);

    vi.setSystemTime(Date.now() + LATEST_SESSION_MS + 1);
    expect(bff.latestSession(session)).toBe(session);
  });

  it('hands back any other session as it is', async () => {
    const real = await realSession();
    expect(bffWith().latestSession(real)).toBe(real);
  });
});
