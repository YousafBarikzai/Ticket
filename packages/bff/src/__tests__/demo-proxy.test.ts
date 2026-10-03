import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@itsm/sdk';
import { DEMO_KEYS, demoWindow, type DemoLiveRecord } from '@itsm/contracts/demo';
import { createBff } from '../bff.js';
import { DEMO_COOKIE, SESSION_COOKIE } from '../cookies.js';
import { memoryLoginCounter, setLoginCounter } from '../demo/handlers.js';
import { memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import { forgetRemints } from '../demo/remint.js';
import { DEMO_SETTING_DEFAULTS } from '../demo/settings.js';
import { demoTokenHash, setDemoTokenStore } from '../demo/store.js';
import type { DemoSession, Session } from '../session.js';
import { setSessionStore } from '../store.js';

/**
 * The proxy and the server-side SDK client for a demo visit (SPEC §4.5 rows
 * X1–X8; §4.6.4 "Transparent re-mint"; A3 §5.3, §6.9).
 *
 * D12's promise is that a reset never shows a visitor "your session ended":
 * the API answers the old generation's token with `401 demo_reset`, and the
 * BFF re-mints once and resends the same request once, so the visitor's next
 * click simply works on the new data. These tests drive that through the
 * real handlers with the API mocked: the bearer changes, the body goes out
 * byte for byte the same, a page's dozen calls re-mint once, and a visit that
 * has really ended says so — handing back a parked real session if it can.
 * Every `it()` name starts with its row id.
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

function live(generation: number, tenantId = generation === 1 ? TENANT_1 : TENANT_2): DemoLiveRecord {
  const prefix = generation === 1 ? 'a1' : 'b2';
  return {
    v: 1,
    tenantId,
    slug: 'demo',
    generation,
    builtAt: Date.UTC(2026, 9, 2),
    anchor: Date.UTC(2026, 9, 2),
    lastResetAt: Date.UTC(2026, 9, 2),
    lastResetReason: 'scheduled',
    personas: {
      employee: { userId: `${prefix}000000-0000-4000-8000-000000000001` },
      agent: { userId: `${prefix}000000-0000-4000-8000-000000000002` },
      admin: { userId: `${prefix}000000-0000-4000-8000-000000000003` },
    },
    agentTeamIds: [],
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
});

const bff = () => createBff(APP, ENV);

/** Re-mints this visit has spent this hour (the first page's slide is one). */
function remints(session: DemoSession): number {
  return Number(tokens.keyspace.get(DEMO_KEYS.remint(session.demoSid, demoWindow('h', Date.now()))) ?? 0);
}

/** A demo session past its first life (as after its first page), so reading it re-mints nothing by itself. */
async function usedDemoSession(overrides: Partial<Session> = {}, id = 'demo-session-1'): Promise<DemoSession> {
  const now = Date.now();
  const minted = await tokens.mint({ app: 'workbench', persona: 'agent', ipb: 'unknown', settings: DEMO_SETTING_DEFAULTS, now });
  if (!minted.ok) throw new Error(`mint refused: ${minted.reason}`);
  await tokens.sessions.put(
    {
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
    },
    900,
  );
  const slid = await bff().sessionFor(id);
  if (slid?.kind !== 'demo') throw new Error('the first page did not slide the token');
  return slid as DemoSession;
}

function problem(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ type: `https://docs.itsm.example/problems/${code}`, title: code, status, detail: code }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function ok(body: unknown = { data: [] }): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** An API that knows only the token it was told is current, and answers every other with `401 demo_reset`. */
function apiAcceptingOnly(current: () => string | null): void {
  upstream.mockImplementation(async (_url: string, init: RequestInit) => {
    const bearer = new Headers(init.headers).get('authorization')?.replace(/^Bearer /, '');
    return bearer === current() ? ok({ data: ['fresh'] }) : problem(401, 'demo_reset');
  });
}

function bearers(): string[] {
  return upstream.mock.calls.map((call) => new Headers((call[1] as RequestInit).headers).get('authorization') ?? '');
}

function proxied(id: string, init: RequestInit = {}, segments = ['api', 'v1', 'tickets']): Promise<Response> {
  return bff().proxy(
    new Request(`${ORIGIN}/api/proxy/${segments.join('/')}`, {
      ...init,
      headers: { 'sec-fetch-site': 'same-origin', cookie: `${SESSION_COOKIE}=${id}`, ...(init.headers as Record<string, string>) },
    }),
    segments,
  );
}

function setCookieFor(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

describe('the proxy for a demo visit (X rows)', () => {
  it('X1 leaves a provider or development session’s 401 exactly as the API sent it, with no re-mint', async () => {
    await tokens.sessions.put(
      { id: 'dev-1', kind: 'dev', accessToken: 'h.e30.s', refreshToken: null, accessExpiresAt: Date.now() + 600_000, tenantId: 't', userId: 'u', displayName: 'D', createdAt: Date.now() },
      600,
    );
    upstream.mockResolvedValue(problem(401, 'demo_reset'));
    const response = await proxied('dev-1');
    expect(response.status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('X2 re-mints once after a reset and resends the same request, byte for byte, with the new bearer', async () => {
    const session = await usedDemoSession();
    tokens.write(DEMO_KEYS.live, live(2));
    let current: string | null = null;
    apiAcceptingOnly(() => current);
    const body = new TextEncoder().encode('{"title":"Printer on fire","notes":"ünïcödé ✓"}');

    // The API accepts only the token the re-mint makes; learn it as it is minted.
    const remint = tokens.remint.bind(tokens);
    vi.spyOn(tokens, 'remint').mockImplementation(async (request) => {
      const result = await remint(request);
      if (result.status === 'ok') current = result.session.accessToken;
      return result;
    });

    const response = await proxied(session.id, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: ['fresh'] });

    expect(upstream).toHaveBeenCalledTimes(2);
    const [first, second] = upstream.mock.calls.map((call) => call[1] as RequestInit);
    expect(new Uint8Array(first!.body as ArrayBuffer)).toEqual(body);
    expect(new Uint8Array(second!.body as ArrayBuffer)).toEqual(body);
    expect(bearers()).toEqual([`Bearer ${session.accessToken}`, `Bearer ${current}`]);

    const stored = await tokens.sessions.get(session.id);
    expect(stored).toMatchObject({ kind: 'demo', demoGeneration: 2, tenantId: TENANT_2, accessToken: current });
    expect(tokens.keyspace.exists(DEMO_KEYS.token(demoTokenHash(session.accessToken)))).toBe(false);
  });

  it('X2 re-mints once for a page’s worth of concurrent calls after a reset', async () => {
    const session = await usedDemoSession();
    tokens.write(DEMO_KEYS.live, live(2));
    apiAcceptingOnly(() => {
      const raw = tokens.keyspace.get(`bff:workbench:sess:${session.id}`);
      const token = raw ? (JSON.parse(raw) as { accessToken: string }).accessToken : null;
      return token === session.accessToken ? null : token;
    });

    const before = remints(session);
    const responses = await Promise.all(Array.from({ length: 6 }, () => proxied(session.id)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    // Six first tries and six resends; one re-mint between them.
    expect(upstream).toHaveBeenCalledTimes(12);
    expect(remints(session) - before).toBe(1);
    expect(new Set(bearers().slice(6)).size).toBe(1);
  });

  it('X3 ends a visit the API says has ended: 401 demo_session_ended, the cookie cleared, the token revoked', async () => {
    const session = await usedDemoSession();
    upstream.mockResolvedValue(problem(401, 'demo_session_ended'));
    const response = await proxied(session.id);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ type: 'https://docs.itsm.example/problems/demo_session_ended', demo: true });
    expect(setCookieFor(response, SESSION_COOKIE)).toContain('Max-Age=0');
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
    expect(tokens.keyspace.exists(DEMO_KEYS.token(demoTokenHash(session.accessToken)))).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('X3 ends the visit when the re-mint after a reset is refused (the demo is paused)', async () => {
    const session = await usedDemoSession();
    tokens.write(DEMO_KEYS.paused, { by: 'operator', at: Date.now(), reason: 'maintenance' });
    upstream.mockResolvedValue(problem(401, 'demo_reset'));
    const response = await proxied(session.id);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ type: expect.stringMatching(/\/demo_session_ended$/) });
    expect(upstream).toHaveBeenCalledTimes(1);
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
  });

  it('X3 hands back a parked real session under the same cookie, and does not clear the cookie', async () => {
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
    const session = await usedDemoSession({ parkedSessionId: real.id });
    upstream.mockResolvedValue(problem(401, 'demo_session_ended'));

    const response = await proxied(session.id);
    expect(response.status).toBe(401);
    expect(setCookieFor(response, SESSION_COOKIE)).toBeUndefined();
    await expect(tokens.sessions.get(session.id)).resolves.toMatchObject({ kind: 'oidc', displayName: 'Jane Smith' });
    await expect(tokens.sessions.get(real.id)).resolves.toBeNull();
  });

  it('X3 is not applied to a token another request already rotated: the request is resent with the newer one', async () => {
    const session = await usedDemoSession();
    let rotated: string | null = null;
    upstream.mockImplementation(async (_url: string, init: RequestInit) => {
      const bearer = new Headers(init.headers).get('authorization');
      if (rotated === null) {
        // Another replica re-mints this visit while the request is in flight.
        const result = await tokens.remint({ sessionId: session.id, app: 'workbench', sid: session.demoSid, currentToken: session.accessToken, settings: DEMO_SETTING_DEFAULTS });
        if (result.status !== 'ok') throw new Error('rotation failed');
        rotated = result.session.accessToken;
        return problem(401, 'demo_session_ended');
      }
      return bearer === `Bearer ${rotated}` ? ok() : problem(401, 'demo_session_ended');
    });
    const response = await proxied(session.id);
    expect(response.status).toBe(200);
    expect(bearers()).toEqual([`Bearer ${session.accessToken}`, `Bearer ${rotated}`]);
    await expect(tokens.sessions.get(session.id)).resolves.toMatchObject({ kind: 'demo', accessToken: rotated });
  });

  it('X4 returns the resend’s own 401 as it is: never a second re-mint in one request', async () => {
    const session = await usedDemoSession();
    upstream.mockImplementation(async () => problem(401, 'demo_reset'));
    const before = remints(session);
    const response = await proxied(session.id);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ type: expect.stringMatching(/\/demo_reset$/) });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(remints(session) - before).toBe(1);
  });

  it('X5 passes 503 demo_unavailable through and keeps the visit', async () => {
    const session = await usedDemoSession();
    upstream.mockResolvedValue(
      new Response(JSON.stringify({ type: 'https://docs.itsm.example/problems/demo_unavailable', reason: 'paused', status: 503 }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '30' },
      }),
    );
    const response = await proxied(session.id);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    await expect(response.json()).resolves.toMatchObject({ reason: 'paused' });
    await expect(tokens.sessions.get(session.id)).resolves.toMatchObject({ kind: 'demo' });
  });

  it('X6 refuses a path outside /api/v1 — the demo routes included — without asking the API', async () => {
    const session = await usedDemoSession();
    const response = await proxied(session.id, { method: 'POST', body: '{"confirm":"RESET"}' }, ['api', 'demo', 'v1', 'reset']);
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('X7 never forwards the visitor’s address, browser or cookies to the API', async () => {
    const session = await usedDemoSession();
    upstream.mockResolvedValue(ok());
    await proxied(session.id, {
      headers: {
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        'x-real-ip': '203.0.113.7',
        forwarded: 'for=203.0.113.7',
        'user-agent': 'Mozilla/5.0 (Prospect)',
        accept: 'application/json',
      },
    });
    const sent = new Headers((upstream.mock.calls[0]![1] as RequestInit).headers);
    for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'user-agent', 'cookie']) expect(sent.get(name)).toBeNull();
    expect(sent.get('accept')).toBe('application/json');
    expect(sent.get('authorization')).toBe(`Bearer ${session.accessToken}`);
  });

  it('X8 re-sets the re-entry cookie with a successful re-mint, until the next reset', async () => {
    const session = await usedDemoSession();
    tokens.write(DEMO_KEYS.live, live(2));
    apiAcceptingOnly(() => {
      const raw = tokens.keyspace.get(`bff:workbench:sess:${session.id}`);
      const token = raw ? (JSON.parse(raw) as { accessToken: string }).accessToken : null;
      return token === session.accessToken ? null : token;
    });
    const response = await proxied(session.id);
    expect(response.status).toBe(200);
    const reentry = setCookieFor(response, DEMO_COOKIE)!;
    expect(reentry).toMatch(/^__Host-itsm-demo=agent\.\d{4}-\d{2}-\d{2}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
    expect(setCookieFor(response, SESSION_COOKIE)).toBeUndefined();
  });
});

describe('the server-side client for a demo visit', () => {
  it('X2 re-mints and resends inside clientFor, and the layout’s latestSession follows', async () => {
    const session = await usedDemoSession();
    tokens.write(DEMO_KEYS.live, live(2));
    apiAcceptingOnly(() => {
      const raw = tokens.keyspace.get(`bff:workbench:sess:${session.id}`);
      const token = raw ? (JSON.parse(raw) as { accessToken: string }).accessToken : null;
      return token === session.accessToken ? null : token;
    });
    const app = bff();
    const client = app.clientFor(session);
    await expect(client.request('/api/v1/me')).resolves.toEqual({ data: ['fresh'] });
    // The rest of this client's calls go out with the new token at once.
    await expect(client.request('/api/v1/tickets')).resolves.toEqual({ data: ['fresh'] });
    expect(upstream).toHaveBeenCalledTimes(3);

    const latest = app.latestSession(session);
    expect(latest.accessToken).not.toBe(session.accessToken);
    expect(latest.demoGeneration).toBe(2);
    // A second client built from the layout's old copy sends the new token, not the deleted one.
    await expect(app.clientFor(session).request('/api/v1/me')).resolves.toEqual({ data: ['fresh'] });
    expect(bearers().at(-1)).toBe(`Bearer ${latest.accessToken}`);
  });

  it('X3 throws ApiError(401) with code demo_session_ended for a visit that has ended', async () => {
    const session = await usedDemoSession();
    upstream.mockResolvedValue(problem(401, 'demo_session_ended'));
    const error = await bff().clientFor(session).request('/api/v1/me').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('demo_session_ended');
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
  });

  it('X1 leaves a provider session’s client alone', async () => {
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
    upstream.mockResolvedValue(problem(401, 'demo_reset'));
    await expect(bff().clientFor(real).request('/api/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
