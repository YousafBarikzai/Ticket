import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBff } from '../bff.js';
import { readCookie, SESSION_COOKIE } from '../cookies.js';
import { memorySessionStore, type SessionStore } from '../session.js';
import { setSessionStore } from '../store.js';

/**
 * The sign-in round trip and the proxy, driven end to end.
 *
 * The individual rules have their own tests; this is about the handlers
 * putting them together — that a code is exchanged once and only once, that a
 * session leaves as a cookie and comes back as a token, and that the two ways
 * a person stops being signed in (logging out, and a session that is gone)
 * both clear the cookie.
 *
 * No server and no framework: the handlers speak `Request` and `Response`, so
 * this is the real code path rather than an approximation of it.
 */

const ORIGIN = 'https://desk.example.test';
const API = 'http://api.internal';

const APP = {
  appName: 'test-app',
  originEnvVar: 'TEST_ORIGIN',
  defaultOrigin: ORIGIN,
  defaultLanding: '/queue',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
};

/** A token whose payload carries the claims the session needs. */
function token(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const ACCESS = token({ tenant_id: 't-1', itsm_user_id: 'u-1', name: 'A Person' });

let store: SessionStore;
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = memorySessionStore();
  setSessionStore(APP.appName, store);
  upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
});

afterEach(() => {
  setSessionStore(APP.appName, null);
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function bffWith(env: Record<string, string | undefined>) {
  return createBff(APP, { TEST_ORIGIN: ORIGIN, API_BASE_URL: API, ...env });
}

const DISCOVERY = {
  authorization_endpoint: 'https://id.example.test/auth',
  token_endpoint: 'https://id.example.test/token',
  end_session_endpoint: 'https://id.example.test/logout',
};

describe('signing in with no identity provider', () => {
  const bff = bffWith({ NODE_ENV: 'development' });

  it('sends the person to the development form, keeping where they were going', async () => {
    const response = await bff.login(new Request(`${ORIGIN}/api/session/login?redirectTo=/tickets/INC-1`));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?redirectTo=%2Ftickets%2FINC-1`);
  });

  it('refuses an off-origin landing page, whatever the link said', async () => {
    const response = await bff.login(new Request(`${ORIGIN}/api/session/login?redirectTo=https://evil.example`));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?redirectTo=%2Fqueue`);
  });

  it('exchanges a tenant and an email for a session cookie', async () => {
    upstream.mockResolvedValueOnce(
      json({ accessToken: ACCESS, expiresInSeconds: 3600, tenantId: 't-1', userId: 'u-1', displayName: 'A Person' }, 201),
    );

    const form = new FormData();
    form.set('tenantSlug', 'acme');
    form.set('email', 'agent@acme.test');
    form.set('redirectTo', '/tickets/INC-1');

    const response = await bff.devSignIn(
      new Request(`${ORIGIN}/api/session/dev`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin' },
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tickets/INC-1`);

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('__Host-session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    // The token is in the store, never in the cookie.
    expect(cookie).not.toContain(ACCESS);

    const id = readCookie(cookie.split(';')[0], SESSION_COOKIE);
    await expect(store.get(id!)).resolves.toMatchObject({ tenantId: 't-1', accessToken: ACCESS });
  });

  it('sends the person back to the form with a reason rather than a stack trace', async () => {
    upstream.mockResolvedValueOnce(json({ title: 'Unauthorized' }, 401));

    const form = new FormData();
    form.set('tenantSlug', 'acme');
    form.set('email', 'nobody@acme.test');

    const response = await bff.devSignIn(
      new Request(`${ORIGIN}/api/session/dev`, { method: 'POST', headers: { origin: ORIGIN }, body: form }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/sign-in?reason=');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a development sign-in posted from another site', async () => {
    const response = await bff.devSignIn(
      new Request(`${ORIGIN}/api/session/dev`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
        body: new FormData(),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('signing in through an identity provider', () => {
  const bff = bffWith({
    NODE_ENV: 'development',
    OIDC_ISSUER: 'https://id.example.test/realms/handlers',
    OIDC_CLIENT_ID: 'workbench',
    OIDC_CLIENT_SECRET: 'shhh',
  });

  it('has no development sign-in at all', async () => {
    expect(bff.developmentSignInAvailable()).toBe(false);
    const response = await bff.devSignIn(new Request(`${ORIGIN}/api/session/dev`, { method: 'POST' }));
    expect(response.status).toBe(404);
  });

  /**
   * Discovery is cached per issuer for the life of the process, so queuing a
   * response for it by call order works once and then silently hands the
   * *next* test's token response to the wrong caller. Routed by URL instead:
   * the document is always available, and the token endpoint is queued.
   */
  function answerDiscovery(): void {
    upstream.mockImplementation(async (input: string) =>
      String(input).includes('.well-known') ? json(DISCOVERY) : json({}, 500),
    );
  }

  async function startLogin(): Promise<string> {
    answerDiscovery();
    const response = await bff.login(new Request(`${ORIGIN}/api/session/login?redirectTo=/tickets/INC-9`));
    expect(response.status).toBe(302);
    return response.headers.get('location') ?? '';
  }

  /** Queues one token-endpoint response, leaving discovery answered from its own route. */
  function answerToken(body: unknown): void {
    upstream.mockImplementation(async (input: string) =>
      String(input).includes('.well-known') ? json(DISCOVERY) : json(body),
    );
  }

  it('redirects to the provider with a challenge and a state', async () => {
    const url = new URL(await startLogin());
    expect(url.origin + url.pathname).toBe('https://id.example.test/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    // The verifier never travels through the browser.
    expect(url.toString()).not.toContain('code_verifier');
  });

  it('exchanges the code, sets the cookie, and lands where the person was going', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;

    answerToken({ access_token: ACCESS, refresh_token: 'rt', expires_in: 300 });
    const response = await bff.callback(new Request(`${ORIGIN}/api/session/callback?code=abc&state=${state}`));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tickets/INC-9`);
    expect(response.headers.get('set-cookie')).toContain('__Host-session=');

    // The exchange carried the verifier that never left the server.
    const body = String(upstream.mock.calls.at(-1)?.[1]?.body ?? '');
    expect(body).toContain('code_verifier=');
    expect(body).toContain('grant_type=authorization_code');
  });

  it('refuses a callback replayed from the back button', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;
    answerToken({ access_token: ACCESS, expires_in: 300 });
    await bff.callback(new Request(`${ORIGIN}/api/session/callback?code=abc&state=${state}`));

    const replay = await bff.callback(new Request(`${ORIGIN}/api/session/callback?code=abc&state=${state}`));
    expect(replay.headers.get('location')).toContain('/signed-out?reason=');
    expect(replay.headers.get('location')).toContain('already%20been%20used');
    expect(replay.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a state nobody issued', async () => {
    const response = await bff.callback(new Request(`${ORIGIN}/api/session/callback?code=abc&state=invented`));
    expect(response.headers.get('location')).toContain('/signed-out?reason=');
  });

  it('does not repeat the provider’s error prose back to the person', async () => {
    const response = await bff.callback(
      new Request(`${ORIGIN}/api/session/callback?error=access_denied&error_description=client+secret+is+wrong`),
    );
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/signed-out?reason=');
    expect(location).not.toContain('secret');
  });
});

describe('signing out', () => {
  const bff = bffWith({ NODE_ENV: 'development' });

  async function signedIn(): Promise<string> {
    upstream.mockResolvedValueOnce(json({ accessToken: ACCESS, expiresInSeconds: 3600, tenantId: 't-1' }, 201));
    const form = new FormData();
    form.set('tenantSlug', 'acme');
    form.set('email', 'agent@acme.test');
    const response = await bff.devSignIn(
      new Request(`${ORIGIN}/api/session/dev`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: form }),
    );
    return readCookie((response.headers.get('set-cookie') ?? '').split(';')[0], SESSION_COOKIE)!;
  }

  it('deletes the record and clears the cookie', async () => {
    const id = await signedIn();
    const response = await bff.logout(
      new Request(`${ORIGIN}/api/session/logout`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', cookie: `${SESSION_COOKIE}=${id}` },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    // The record is what actually ends the session; the cookie is a hint.
    await expect(store.get(id)).resolves.toBeNull();
  });

  it('cannot be triggered from another site', async () => {
    const id = await signedIn();
    const response = await bff.logout(
      new Request(`${ORIGIN}/api/session/logout`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', cookie: `${SESSION_COOKIE}=${id}` },
      }),
    );
    expect(response.status).toBe(403);
    await expect(store.get(id)).resolves.not.toBeNull();
  });
});

describe('the proxy', () => {
  const bff = bffWith({ NODE_ENV: 'development' });

  async function signedIn(): Promise<string> {
    upstream.mockResolvedValueOnce(json({ accessToken: ACCESS, expiresInSeconds: 3600, tenantId: 't-1' }, 201));
    const form = new FormData();
    form.set('tenantSlug', 'acme');
    form.set('email', 'agent@acme.test');
    const response = await bff.devSignIn(
      new Request(`${ORIGIN}/api/session/dev`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: form }),
    );
    return readCookie((response.headers.get('set-cookie') ?? '').split(';')[0], SESSION_COOKIE)!;
  }

  it('adds the session’s token and forwards the query string', async () => {
    const id = await signedIn();
    upstream.mockResolvedValueOnce(json({ data: [] }, 200, { etag: '"3"' }));

    const response = await bff.proxy(
      new Request(`${ORIGIN}/api/proxy/api/v1/tickets?filter%5Bstatus%5D=new`, {
        headers: { cookie: `${SESSION_COOKIE}=${id}`, accept: 'application/json' },
      }),
      ['api', 'v1', 'tickets'],
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"3"');

    const [url, init] = upstream.mock.calls.at(-1)!;
    expect(url).toBe(`${API}/api/v1/tickets?filter%5Bstatus%5D=new`);
    expect((init.headers as Headers).get('authorization')).toBe(`Bearer ${ACCESS}`);
    expect((init.headers as Headers).get('cookie')).toBeNull();
  });

  it('answers 401 and clears the cookie when the session is gone', async () => {
    const response = await bff.proxy(
      new Request(`${ORIGIN}/api/proxy/api/v1/me`, { headers: { cookie: `${SESSION_COOKIE}=vanished` } }),
      ['api', 'v1', 'me'],
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    // 401, not a redirect: the caller is `fetch`, and an HTML page arrives as
    // a JSON parse error.
    expect(response.headers.get('content-type')).toContain('problem+json');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('never lets the API set a cookie on this origin', async () => {
    const id = await signedIn();
    upstream.mockResolvedValueOnce(
      json({}, 200, { 'set-cookie': '__Host-session=forged; Path=/; Secure' }),
    );

    const response = await bff.proxy(
      new Request(`${ORIGIN}/api/proxy/api/v1/me`, { headers: { cookie: `${SESSION_COOKIE}=${id}` } }),
      ['api', 'v1', 'me'],
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a path outside the versioned API without asking the API', async () => {
    const id = await signedIn();
    const response = await bff.proxy(
      new Request(`${ORIGIN}/api/proxy/metrics`, { headers: { cookie: `${SESSION_COOKIE}=${id}` } }),
      ['metrics'],
    );
    expect(response.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1); // only the sign-in
  });

  it('reports an unreachable API as 502, not 500', async () => {
    const id = await signedIn();
    upstream.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await bff.proxy(
      new Request(`${ORIGIN}/api/proxy/api/v1/me`, { headers: { cookie: `${SESSION_COOKIE}=${id}` } }),
      ['api', 'v1', 'me'],
    );
    expect(response.status).toBe(502);
  });
});
