import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_KEYS, DEMO_SID_PATTERN, isDemoKey, ukDateKey, type DemoLiveRecord } from '@itsm/contracts/demo';
import { createBff } from '../bff.js';
import { DEMO_COOKIE, readCookie, SESSION_COOKIE, violatesHostPrefix } from '../cookies.js';
import { memoryLoginCounter, setLoginCounter } from '../demo/handlers.js';
import { ipBucket } from '../demo/ip.js';
import { memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import { forgetRemints } from '../demo/remint.js';
import { demoTokenHash, sessionRecordKey, setDemoTokenStore } from '../demo/store.js';
import type { Session } from '../session.js';
import { setSessionStore } from '../store.js';

/**
 * `POST /api/session/demo` (SPEC §4.5 rows M1–M7; A3 §5.3, §6.3).
 *
 * The one route that mints. Every `it()` name starts with its row id. The
 * cases are chosen for the promises the route keeps: it never answers 200
 * (only a 303 or a problem), only a same-origin form reaches the mint, a real
 * session is never replaced without being asked, a refusal goes back to
 * `/demo` with a reason the page words, and a success sets two cookies as
 * two headers — the session for a day and the re-entry cookie until the
 * reset. A3 §5.6: "D's Max-Age equals secondsUntilNextReset at 23:59:30
 * London (30)".
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

const TENANT = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const AGENT = 'a1000000-0000-4000-8000-000000000002';

function live(generation = 1): DemoLiveRecord {
  return {
    v: 1,
    tenantId: TENANT,
    slug: 'demo',
    generation,
    builtAt: Date.UTC(2026, 9, 2),
    anchor: Date.UTC(2026, 9, 2),
    lastResetAt: Date.UTC(2026, 9, 2),
    lastResetReason: 'scheduled',
    personas: {
      employee: { userId: 'a1000000-0000-4000-8000-000000000001' },
      agent: { userId: AGENT },
      admin: { userId: 'a1000000-0000-4000-8000-000000000003' },
    },
    agentTeamIds: ['c3000000-0000-4000-8000-000000000001'],
  };
}

let tokens: MemoryDemoTokenStore;
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tokens = memoryDemoTokenStore({ appName: 'workbench', clock: () => Date.now() });
  setSessionStore('workbench', tokens.sessions);
  setDemoTokenStore('workbench', tokens);
  setLoginCounter('workbench', memoryLoginCounter(tokens.keyspace));
  tokens.write(DEMO_KEYS.live, live(1));
  forgetRemints();
  upstream = vi.fn(async () => new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', upstream);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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

function signIn(
  bff: ReturnType<typeof bffWith>,
  fields: Record<string, string> = { persona: 'agent', redirectTo: '/tickets/INC-0042' },
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.10' },
): Promise<Response> {
  return bff.demoSignIn(
    new Request(`${ORIGIN}/api/session/demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

function setCookieFor(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

function attributesOf(header: string) {
  const parts = header.split(';').map((part) => part.trim());
  const value = (name: string) => parts.find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}=`))?.split('=')[1];
  return { secure: parts.includes('Secure'), path: value('Path'), domain: value('Domain'), maxAge: Number(value('Max-Age')) };
}

function location(response: Response): URL {
  return new URL(response.headers.get('location') ?? '');
}

async function sessionOf(response: Response): Promise<Session> {
  const id = readCookie(setCookieFor(response, SESSION_COOKIE)?.split(';')[0], SESSION_COOKIE)!;
  const session = await tokens.sessions.get(id);
  if (!session) throw new Error('no session behind the cookie');
  return session;
}

/** A real (provider) session in the store, as a callback would have left it. */
async function realSession(id = 'real-session-1'): Promise<Session> {
  const session: Session = {
    id,
    kind: 'oidc',
    accessToken: 'h.e30.s',
    refreshToken: 'rt-1',
    accessExpiresAt: Date.now() + 300_000,
    tenantId: 'standard-tenant',
    userId: 'u-1',
    displayName: 'Jane Smith',
    createdAt: Date.now(),
  };
  await tokens.sessions.put(session, 43_200);
  return session;
}

describe('POST /api/session/demo (M rows)', () => {
  it('M1 is a 404 while the demo is off here', async () => {
    const response = await signIn(bffWith({ DEMO_MODE: 'off' }));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('problem+json');
    expect(tokens.keyspace.keys().filter((key) => key.startsWith('demo:tok:'))).toEqual([]);
  });

  it('M1 is a 404 for a BFF that is not one of the three areas', async () => {
    const bff = createBff({ ...APP, appName: 'reports' }, ENV);
    expect((await signIn(bff)).status).toBe(404);
  });

  it.each([
    ['another site', { 'sec-fetch-site': 'cross-site' }],
    ['a sibling app on the same site', { 'sec-fetch-site': 'same-site' }],
    ['a client that claims no origin at all', {}],
    ['a foreign Origin header', { origin: 'https://evil.example' }],
  ])('M2 refuses a form posted from %s with 403, and mints nothing', async (_label, headers) => {
    const response = await signIn(bffWith(), undefined, headers);
    expect(response.status).toBe(403);
    expect(tokens.keyspace.keys().filter((key) => key.startsWith('demo:tok:'))).toEqual([]);
  });

  it.each([
    ['another app’s persona', { persona: 'employee' }],
    ['no persona', { redirectTo: '/overview' }],
    ['a persona nobody has', { persona: 'root' }],
  ])('M3 sends a form with %s back to /demo with reason=invalid', async (_label, fields) => {
    const response = await signIn(bffWith(), fields);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/demo?demo=1&reason=invalid`);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('M3 sends a body that is not a form back with reason=invalid', async () => {
    const response = await bffWith().demoSignIn(
      new Request(`${ORIGIN}/api/session/demo`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: '{"persona":"agent"}',
      }),
    );
    expect(response.status).toBe(303);
    expect(location(response).searchParams.get('reason')).toBe('invalid');
  });

  it('M4 sends a browser already in today’s demo on without minting a second token', async () => {
    const bff = bffWith();
    const first = await signIn(bff);
    const cookie = setCookieFor(first, SESSION_COOKIE)!.split(';')[0]!;
    const before = tokens.keyspace.keys().filter((key) => key.startsWith('demo:tok:'));

    const again = await signIn(bff, { persona: 'agent', redirectTo: '/overview' }, { 'sec-fetch-site': 'same-origin', cookie });
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toBe(`${ORIGIN}/overview`);
    expect(again.headers.getSetCookie()).toEqual([]);
    // The first page render slid the first token to a new one; still one token.
    expect(tokens.keyspace.keys().filter((key) => key.startsWith('demo:tok:'))).toHaveLength(before.length);
  });

  it('M5 asks a person signed in to their own account before replacing it', async () => {
    const real = await realSession();
    const response = await signIn(bffWith(), undefined, { 'sec-fetch-site': 'same-origin', cookie: `${SESSION_COOKIE}=${real.id}` });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/demo?demo=1&redirectTo=%2Ftickets%2FINC-0042&reason=confirm`);
    expect(response.headers.getSetCookie()).toEqual([]);
    await expect(tokens.sessions.get(real.id)).resolves.toMatchObject({ kind: 'oidc', displayName: 'Jane Smith' });
  });

  it('M6 sends a paused demo back with reason=paused', async () => {
    tokens.write(DEMO_KEYS.paused, { by: 'operator', at: Date.now(), reason: 'maintenance' });
    const response = await signIn(bffWith());
    expect(location(response).searchParams.get('reason')).toBe('paused');
    expect(location(response).searchParams.get('redirectTo')).toBe('/tickets/INC-0042');
  });

  it('M6 sends a demo with nothing live back with reason=preparing', async () => {
    tokens.write(DEMO_KEYS.live, 'not a record');
    const response = await signIn(bffWith());
    expect(location(response).searchParams.get('reason')).toBe('preparing');
  });

  it('M6 sends the 31st mint in a minute from one network back with reason=busy', async () => {
    const bff = bffWith();
    for (let index = 0; index < 30; index += 1) {
      expect(location(await signIn(bff)).pathname).toBe('/tickets/INC-0042');
    }
    const response = await signIn(bff);
    expect(location(response).pathname).toBe('/demo');
    expect(location(response).searchParams.get('reason')).toBe('busy');
  });

  it('M6 answers reason=capacity when the demo is full and nobody is idle', async () => {
    const bff = bffWith({ DEMO_MAX_LIVE_TOKENS: '1', DEMO_MAX_LIVE_PER_IP: '1' });
    expect(location(await signIn(bff)).pathname).toBe('/tickets/INC-0042');
    const response = await signIn(bff, undefined, { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.20' });
    expect(location(response).searchParams.get('reason')).toBe('capacity');
  });

  it('M6 answers a store that cannot be reached with reason=busy, not a 500', async () => {
    setDemoTokenStore('workbench', { ...tokens, mint: () => Promise.reject(new Error('ECONNREFUSED')) });
    const response = await signIn(bffWith());
    expect(response.status).toBe(303);
    expect(location(response).searchParams.get('reason')).toBe('busy');
  });

  it('M7 mints, stores a demo session and sets the session and re-entry cookies as two headers', async () => {
    const response = await signIn(bffWith());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tickets/INC-0042`);

    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const session = setCookieFor(response, SESSION_COOKIE)!;
    const reentry = setCookieFor(response, DEMO_COOKIE)!;
    for (const header of [session, reentry]) {
      expect(violatesHostPrefix(header.split('=')[0]!, attributesOf(header))).toBeNull();
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
    }
    expect(attributesOf(session).maxAge).toBe(86_400);
    expect(reentry.split(';')[0]).toBe(`${DEMO_COOKIE}=agent.${ukDateKey(Date.now())}`);

    const stored = await sessionOf(response);
    expect(stored).toMatchObject({
      kind: 'demo',
      persona: 'agent',
      demoGeneration: 1,
      tenantId: TENANT,
      userId: AGENT,
      displayName: 'Alex Morgan',
      refreshToken: null,
    });
    expect(stored.demoSid).toMatch(DEMO_SID_PATTERN);
    expect(stored.parkedSessionId).toBeUndefined();
    // The token is in the store, never in a cookie.
    expect(cookies.join('\n')).not.toContain(stored.accessToken);
    // First life: fifteen minutes until the first page slides it.
    expect(stored.accessExpiresAt - stored.createdAt).toBe(900_000);
    // A demo session is never recorded with the API.
    expect(upstream).not.toHaveBeenCalled();
  });

  it('M7 buckets the visitor by a salted hash of the address: no raw IP in any key or record', async () => {
    const response = await signIn(bffWith());
    const stored = await sessionOf(response);
    const record = JSON.parse(tokens.keyspace.get(DEMO_KEYS.token(demoTokenHash(stored.accessToken)))!) as { ipb: string };
    const salt = await tokens.daySalt(ukDateKey(Date.now()));
    expect(record.ipb).toBe(ipBucket('203.0.113.10', salt));
    for (const key of tokens.keyspace.keys()) {
      expect(key).not.toContain('203.0.113.10');
      expect(isDemoKey(key) || key.startsWith('bff:workbench:')).toBe(true);
    }
  });

  it('M7 sets the re-entry cookie to live only until the reset: 30 s at 23:59:30 London', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:59:30 BST on 2 Oct 2026 is 22:59:30 UTC.
    vi.setSystemTime(Date.UTC(2026, 9, 2, 22, 59, 30));
    const response = await signIn(bffWith());
    const reentry = setCookieFor(response, DEMO_COOKIE)!;
    expect(attributesOf(reentry).maxAge).toBe(30);
    expect(reentry.split(';')[0]).toBe(`${DEMO_COOKIE}=agent.2026-10-02`);
  });

  it('M7 parks a real session it was asked to replace, so ending the demo can hand it back', async () => {
    const real = await realSession();
    const response = await signIn(
      bffWith(),
      { persona: 'agent', redirectTo: '/overview', confirm: 'replace' },
      { 'sec-fetch-site': 'same-origin', cookie: `${SESSION_COOKIE}=${real.id}` },
    );
    expect(response.headers.get('location')).toBe(`${ORIGIN}/overview`);
    const stored = await sessionOf(response);
    expect(stored.kind).toBe('demo');
    expect(stored.parkedSessionId).toBe(real.id);
    // Parked, not signed out: the record is still there to come back to.
    await expect(tokens.sessions.get(real.id)).resolves.toMatchObject({ kind: 'oidc' });
  });

  it('M7 revokes a stale demo session it replaces and carries its parked session forward', async () => {
    const real = await realSession();
    const bff = bffWith();
    const first = await signIn(
      bff,
      { persona: 'agent', redirectTo: '/overview', confirm: 'replace' },
      { 'sec-fetch-site': 'same-origin', cookie: `${SESSION_COOKIE}=${real.id}` },
    );
    const cookie = setCookieFor(first, SESSION_COOKIE)!.split(';')[0]!;
    // The first page render slides the token to its full life (F8)…
    const stale = (await bff.sessionFor(readCookie(cookie, SESSION_COOKIE)))!;
    expect(stale.demoGeneration).toBe(1);

    // …then the demo is rebuilt: the session is a generation behind (not M4),
    // and it is not due a slide, so it reaches the mint as it is.
    tokens.write(DEMO_KEYS.live, live(2));
    const second = await signIn(bff, { persona: 'agent', redirectTo: '/overview' }, { 'sec-fetch-site': 'same-origin', cookie });
    const fresh = await sessionOf(second);

    expect(fresh.id).not.toBe(stale.id);
    expect(fresh.demoGeneration).toBe(2);
    expect(fresh.parkedSessionId).toBe(real.id);
    expect(tokens.keyspace.exists(sessionRecordKey('workbench', stale.id))).toBe(false);
    expect(tokens.keyspace.exists(DEMO_KEYS.token(demoTokenHash(stale.accessToken)))).toBe(false);
  });

  it('M7 logs the mint with at most eight characters of the hash, never the token or the address', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await signIn(bffWith());
    const stored = await sessionOf(response);
    const lines = info.mock.calls.map((call) => String(call[0]));
    const mint = lines.find((line) => line.includes('demo mint'));
    expect(mint).toMatch(/^\[bff:workbench\] demo mint result=ok persona=agent gen=1 token=[0-9a-f]{8}$/);
    expect(lines.join('\n')).not.toContain(stored.accessToken);
    expect(lines.join('\n')).not.toContain('203.0.113.10');
  });
});
