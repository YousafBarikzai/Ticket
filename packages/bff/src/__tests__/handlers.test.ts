import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBff } from '../bff.js';
import {
  cookieAttributes,
  DEMO_COOKIE,
  demoCookieValue,
  GENERIC_SIGN_IN_FAILURE,
  isSignInFailureReason,
  readCookie,
  RETRY_COOKIE,
  RETRY_COOKIE_SECONDS,
  SESSION_COOKIE,
  SIGN_IN_FAILURE_REASONS,
  signInFailureSentence,
  violatesHostPrefix,
} from '../cookies.js';
import { DEMO_KEYS } from '@itsm/contracts/demo';
import { memoryLoginCounter, setLoginCounter } from '../demo/handlers.js';
import { memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import { forgetRemints } from '../demo/remint.js';
import { DEMO_SETTING_DEFAULTS } from '../demo/settings.js';
import { demoTokenHash, setDemoTokenStore } from '../demo/store.js';
import { memorySessionStore, type Session, type SessionStore } from '../session.js';
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
 * The sign-in state machine's rows (SPEC v3 §4.5: L for login, C for the
 * callback, O for logout) each have a test whose name starts with the row's
 * id, so a row without a test is visible in the list rather than in review.
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
let tokens: MemoryDemoTokenStore;
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = memorySessionStore();
  setSessionStore(APP.appName, store);
  // Signing in counts against the L0 limiter in every mode, which reads the
  // day's IP salt from the demo store: both in memory, so no test reaches a
  // real Redis.
  tokens = memoryDemoTokenStore({ appName: APP.appName, clock: () => Date.now() });
  forgetRemints();
  setDemoTokenStore(APP.appName, tokens);
  setLoginCounter(APP.appName, memoryLoginCounter(tokens.keyspace));
  upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
});

afterEach(() => {
  setSessionStore(APP.appName, null);
  setDemoTokenStore(APP.appName, null);
  setLoginCounter(APP.appName, null);
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * What `POST /api/v1/auth/session` answers.
 *
 * Every sign-in now tells the API about the session it just minted, so every
 * test that signs somebody in makes one more request than it used to. Named
 * rather than inlined, so the extra call is visible where it happens instead
 * of being an unexplained `mockResolvedValueOnce`.
 */
const RECORDED = { id: 'sess-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastSeenAt: new Date().toISOString() };

/** True when this fetch call was the session recording rather than real work. */
function isSessionRecord(call: unknown[]): boolean {
  return String(call[0]).endsWith('/api/v1/auth/session');
}

function bffWith(env: Record<string, string | undefined>) {
  return createBff(APP, { TEST_ORIGIN: ORIGIN, API_BASE_URL: API, ...env });
}

const DISCOVERY = {
  authorization_endpoint: 'https://id.example.test/auth',
  token_endpoint: 'https://id.example.test/token',
  end_session_endpoint: 'https://id.example.test/logout',
};

/** Every `Set-Cookie` a response carries, one entry per header. */
function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

/** The one `Set-Cookie` for a cookie name, or undefined. */
function setCookieFor(response: Response, name: string): string | undefined {
  return setCookies(response).find((header) => header.startsWith(`${name}=`));
}

/**
 * A serialised cookie read back into the attributes `violatesHostPrefix`
 * checks, so a test asserts the browser's rule rather than a substring.
 */
function attributesOf(header: string): { secure: boolean; path: string | undefined; domain: string | undefined } {
  const parts = header.split(';').map((part) => part.trim());
  const value = (name: string) =>
    parts.find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}=`))?.split('=')[1];
  return { secure: parts.includes('Secure'), path: value('Path'), domain: value('Domain') };
}

/** The `reason` a redirect to `/signed-out` carries, asserted to be one the page knows. */
function reasonOf(response: Response): string | null {
  const location = new URL(response.headers.get('location') ?? '');
  expect(location.origin + location.pathname).toBe(`${ORIGIN}/signed-out`);
  const reason = location.searchParams.get('reason');
  expect(isSignInFailureReason(reason)).toBe(true);
  return reason;
}

describe('signing in with no identity provider', () => {
  const bff = bffWith({ NODE_ENV: 'development' });

  it('L5 sends the person to the development form, keeping where they were going', async () => {
    const response = await bff.login(new Request(`${ORIGIN}/api/session/login?redirectTo=/tickets/INC-1`));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?redirectTo=%2Ftickets%2FINC-1`);
  });

  it('L5 refuses an off-origin landing page, whatever the link said', async () => {
    const response = await bff.login(new Request(`${ORIGIN}/api/session/login?redirectTo=https://evil.example`));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?redirectTo=%2Fqueue`);
  });

  it('exchanges a tenant and an email for a session cookie', async () => {
    upstream.mockResolvedValueOnce(
      json({ accessToken: ACCESS, expiresInSeconds: 3600, tenantId: 't-1', userId: 'u-1', displayName: 'A Person' }, 201),
    );
    upstream.mockResolvedValueOnce(json(RECORDED, 201));

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

    // The API was told, with the token as the only evidence. Without this the
    // session exists in Redis and nowhere else, which is what made "sign out
    // everywhere" a promise the platform could not keep.
    const record = upstream.mock.calls.find(isSessionRecord);
    expect(record?.[0]).toBe(`${API}/api/v1/auth/session`);
    expect(record?.[1]?.method).toBe('POST');
    expect(record?.[1]?.headers?.authorization).toBe(`Bearer ${ACCESS}`);
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

  it('C4 answers a callback with reason=config when no provider is configured', async () => {
    const response = await bff.callback(new Request(`${ORIGIN}/api/session/callback?code=abc&state=xyz`));
    expect(response.status).toBe(302);
    expect(reasonOf(response)).toBe('config');
    expect(setCookies(response)).toEqual([]);
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
   * Routes every URL the handlers touch: discovery, the token and end-session
   * endpoints, and the API's session record.
   *
   * Discovery is cached per issuer for the life of the process, so queuing a
   * response for it by call order works once and then silently hands the
   * *next* test's token response to the wrong caller. Routed by URL instead:
   * the document is always available, and each endpoint answers as the test
   * says (the token endpoint fails, and the end-session endpoint answers 204,
   * unless told otherwise).
   */
  function provider(answers: { token?: () => Response; logout?: () => Response | Promise<Response> } = {}): void {
    upstream.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes('.well-known')) return json(DISCOVERY);
      if (url.endsWith('/api/v1/auth/session')) return json(RECORDED, 201);
      if (url === DISCOVERY.token_endpoint) return answers.token ? answers.token() : json({}, 500);
      if (url === DISCOVERY.end_session_endpoint) {
        return answers.logout ? answers.logout() : new Response(null, { status: 204 });
      }
      return json({}, 404);
    });
  }

  function answerToken(body: unknown): void {
    provider({ token: () => json(body) });
  }

  async function startLogin(query = 'redirectTo=/tickets/INC-9'): Promise<string> {
    provider();
    const response = await bff.login(new Request(`${ORIGIN}/api/session/login?${query}`));
    expect(response.status).toBe(302);
    return response.headers.get('location') ?? '';
  }

  /** Signs in through the provider, returning the session cookie's value. */
  async function signedIn(): Promise<string> {
    const state = new URL(await startLogin()).searchParams.get('state')!;
    answerToken({ access_token: ACCESS, refresh_token: 'rt-1', expires_in: 300 });
    const response = await bff.callback(new Request(`${ORIGIN}/api/session/callback?code=abc&state=${state}`));
    return readCookie(setCookieFor(response, SESSION_COOKIE)?.split(';')[0], SESSION_COOKIE)!;
  }

  function callback(query: string, cookie?: string): Promise<Response> {
    return bff.callback(
      new Request(`${ORIGIN}/api/session/callback?${query}`, cookie ? { headers: { cookie } } : undefined),
    );
  }

  it('L6 redirects to the provider with a challenge and a state', async () => {
    const url = new URL(await startLogin());
    expect(url.origin + url.pathname).toBe('https://id.example.test/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    // The verifier never travels through the browser.
    expect(url.toString()).not.toContain('code_verifier');
  });

  it('L6 keeps the pending sign-in for 1,800 s, as long as the provider keeps its login page', async () => {
    const putPending = vi.spyOn(store, 'putPending');
    await startLogin();
    expect(putPending).toHaveBeenCalledTimes(1);
    expect(putPending).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirectTo: '/tickets/INC-9' }),
      1800,
    );
  });

  it('L6 passes an address on to the provider as login_hint', async () => {
    const url = new URL(await startLogin(`login_hint=${encodeURIComponent('alex.morgan@northwind.example')}`));
    expect(url.searchParams.get('login_hint')).toBe('alex.morgan@northwind.example');

    // The longest address SMTP can carry is still an address.
    const longest = `${'a'.repeat(247)}@b.test`;
    expect(longest).toHaveLength(254);
    expect(new URL(await startLogin(`login_hint=${longest}`)).searchParams.get('login_hint')).toBe(longest);
  });

  it.each([
    ['not an address', 'alex.morgan'],
    ['two at-signs', 'a@b@c.test'],
    ['nothing before the at-sign', '@northwind.example'],
    ['whitespace', 'alex morgan@northwind.example'],
    ['a line break', 'alex@northwind.example\nX-Injected: 1'],
    ['a control character', 'alex@northwind.example\u0000'],
    ['a C1 control character', 'alex@northwind.example\u0085'],
    ['more than 254 characters', `${'a'.repeat(248)}@b.test`],
    ['an empty value', ''],
  ])('L6 drops a login_hint with %s', async (_label, hint) => {
    const url = new URL(await startLogin(`login_hint=${encodeURIComponent(hint)}`));
    expect(url.searchParams.has('login_hint')).toBe(false);
  });

  it('L6 passes the tenant’s provider hint, so nobody picks from a list of other tenants', async () => {
    const url = new URL(await startLogin('idp=acme-saml'));
    expect(url.searchParams.get('kc_idp_hint')).toBe('acme-saml');
  });

  it.each(['login_required', 'interaction_required'])(
    'C1 sends %s back to the sign-in page, not to an error',
    async (error) => {
      const response = await callback(`error=${error}&state=whatever`);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?redirectTo=%2Fqueue`);
      expect(setCookies(response)).toEqual([]);
    },
  );

  it('C2 answers any other provider error with reason=provider, never the provider’s prose', async () => {
    const response = await callback('error=access_denied&error_description=client+secret+is+wrong');
    expect(response.status).toBe(302);
    expect(reasonOf(response)).toBe('provider');
    expect(response.headers.get('location')).not.toContain('secret');
    expect(setCookies(response)).toEqual([]);
  });

  it.each([
    ['a code but no state', 'code=abc'],
    ['a state but no code', 'state=xyz'],
    ['neither', ''],
  ])('C3 answers a callback with %s with reason=incomplete', async (_label, query) => {
    const response = await callback(query);
    expect(reasonOf(response)).toBe('incomplete');
  });

  it('C5 sends a person who is already signed in to the app when they press Back, and spends no retry', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;
    answerToken({ access_token: ACCESS, refresh_token: 'rt-1', expires_in: 300 });
    const first = await callback(`code=abc&state=${state}`);
    const id = readCookie(setCookieFor(first, SESSION_COOKIE)?.split(';')[0], SESSION_COOKIE)!;

    // The same callback URL again, from the history, with the new session's
    // cookie (and a retry marker from earlier, which this clears).
    const replay = await callback(`code=abc&state=${state}`, `${SESSION_COOKIE}=${id}; ${RETRY_COOKIE}=1`);

    expect(replay.status).toBe(302);
    expect(replay.headers.get('location')).toBe(`${ORIGIN}/queue`);
    expect(setCookieFor(replay, SESSION_COOKIE)).toBeUndefined();
    expect(setCookieFor(replay, RETRY_COOKIE)).toContain('Max-Age=0');
    // Still signed in, and the code was not exchanged a second time.
    await expect(store.get(id)).resolves.not.toBeNull();
    expect(upstream.mock.calls.filter((call) => String(call[0]) === DISCOVERY.token_endpoint)).toHaveLength(1);
  });

  it('C6 restarts a callback that finds no pending sign-in once, and marks the retry for 60 s', async () => {
    const response = await callback('code=abc&state=invented');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/api/session/login?redirectTo=%2Fqueue`);

    const marker = setCookieFor(response, RETRY_COOKIE)!;
    expect(marker).toContain('Max-Age=60');
    expect(marker).toContain('HttpOnly');
    expect(marker).toContain('SameSite=Lax');
    expect(violatesHostPrefix(RETRY_COOKIE, attributesOf(marker))).toBeNull();
    expect(setCookieFor(response, SESSION_COOKIE)).toBeUndefined();
    // Nothing was exchanged: a code whose state nobody issued is never spent.
    expect(upstream.mock.calls.filter((call) => String(call[0]) === DISCOVERY.token_endpoint)).toHaveLength(0);
  });

  it('C6 → L6 → C9: the silent restart finishes the sign-in and clears the marker', async () => {
    const restart = await callback('code=stale&state=invented');
    const marker = setCookieFor(restart, RETRY_COOKIE)!.split(';')[0]!;

    // The browser follows the restart to this app's login, and the provider's
    // single sign-on answers at once with a fresh code for a fresh state.
    provider();
    const login = await bff.login(new Request(restart.headers.get('location')!, { headers: { cookie: marker } }));
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!;

    answerToken({ access_token: ACCESS, refresh_token: 'rt-1', expires_in: 300 });
    const done = await callback(`code=fresh&state=${state}`, marker);

    expect(done.headers.get('location')).toBe(`${ORIGIN}/queue`);
    expect(setCookieFor(done, SESSION_COOKIE)).toContain('__Host-session=');
    expect(setCookieFor(done, RETRY_COOKIE)).toContain('Max-Age=0');
  });

  it('C6 then C7: a callback replayed from the back button retries once, then reports reason=stale', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;
    answerToken({ access_token: ACCESS, expires_in: 300 });
    await callback(`code=abc&state=${state}`);

    // No session cookie on the replay (a different browser profile, or one
    // that has since been signed out): the first miss restarts silently…
    const first = await callback(`code=abc&state=${state}`);
    expect(first.headers.get('location')).toBe(`${ORIGIN}/api/session/login?redirectTo=%2Fqueue`);
    const marker = setCookieFor(first, RETRY_COOKIE)!.split(';')[0]!;

    // …and a second miss inside the minute stops, rather than looping.
    const second = await callback(`code=abc&state=${state}`, marker);
    expect(second.status).toBe(302);
    expect(reasonOf(second)).toBe('stale');
    expect(setCookieFor(second, RETRY_COOKIE)).toContain('Max-Age=0');
    expect(setCookieFor(second, SESSION_COOKIE)).toBeUndefined();
  });

  it('C7 reports reason=stale for a state nobody issued once the retry is spent', async () => {
    const response = await callback('code=abc&state=invented', `${RETRY_COOKIE}=1`);
    expect(reasonOf(response)).toBe('stale');
  });

  it('C8 answers a token that names no tenant with reason=no_tenant', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;
    answerToken({ access_token: token({ sub: 'kc-1', name: 'No Tenant' }), expires_in: 300 });
    const response = await callback(`code=abc&state=${state}`);
    expect(reasonOf(response)).toBe('no_tenant');
    expect(setCookieFor(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('C8 answers a refused exchange with reason=refused, never the provider’s prose', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;
    provider({ token: () => json({ error: 'invalid_client', error_description: 'client secret is wrong' }, 400) });
    const response = await callback(`code=abc&state=${state}`);
    expect(reasonOf(response)).toBe('refused');
    expect(response.headers.get('location')).not.toContain('secret');
  });

  it('C9 exchanges the code, sets the session, clears the retry marker and lands where the person was going', async () => {
    const state = new URL(await startLogin()).searchParams.get('state')!;

    answerToken({ access_token: ACCESS, refresh_token: 'rt', expires_in: 300 });
    const response = await callback(`code=abc&state=${state}`, `${RETRY_COOKIE}=1`);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tickets/INC-9`);

    // Three cookies, as three headers: folded into one, the browser would
    // read none of them as intended. The demo's re-entry cookie goes too: a
    // real sign-in always wins (D22).
    expect(setCookies(response)).toHaveLength(3);
    const session = setCookieFor(response, SESSION_COOKIE)!;
    const retry = setCookieFor(response, RETRY_COOKIE)!;
    const reentry = setCookieFor(response, DEMO_COOKIE)!;
    expect(session).toContain('Max-Age=43200');
    expect(retry).toContain('Max-Age=0');
    expect(reentry).toContain('Max-Age=0');
    for (const header of [session, retry, reentry]) {
      expect(violatesHostPrefix(header.split('=')[0]!, attributesOf(header))).toBeNull();
    }

    // The exchange carried the verifier that never left the server. Found by
    // URL, not by position: the callback's last request is now the session
    // record, and a positional assertion would have silently started checking
    // the wrong call.
    const exchange = upstream.mock.calls.find((call) => String(call[0]) === DISCOVERY.token_endpoint);
    const body = String(exchange?.[1]?.body ?? '');
    expect(body).toContain('code_verifier=');
    expect(body).toContain('grant_type=authorization_code');
  });

  describe('signing out', () => {
    function logout(cookie?: string): Promise<Response> {
      return bff.logout(
        new Request(`${ORIGIN}/api/session/logout`, {
          method: 'POST',
          headers: { 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
        }),
      );
    }

    function endSessionCalls() {
      return upstream.mock.calls.filter((call) => String(call[0]) === DISCOVERY.end_session_endpoint);
    }

    it('O1 cannot be triggered from another site, and ends nothing at the provider', async () => {
      const id = await signedIn();
      const response = await bff.logout(
        new Request(`${ORIGIN}/api/session/logout`, {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site', cookie: `${SESSION_COOKIE}=${id}` },
        }),
      );
      expect(response.status).toBe(403);
      // A refused request changes nothing, the re-entry cookie included.
      expect(setCookies(response)).toEqual([]);
      await expect(store.get(id)).resolves.not.toBeNull();
      expect(endSessionCalls()).toHaveLength(0);
    });

    it('O4 ends the provider session over the back channel, then 303s to this app’s own signed-out page', async () => {
      const id = await signedIn();
      provider();

      const response = await logout(`${SESSION_COOKIE}=${id}`);

      expect(response.status).toBe(303);
      // Same origin: the browser never goes to the provider, so neither a
      // `form-action 'self'` block nor the provider's confirmation page can
      // get in the way.
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out`);
      expect(setCookieFor(response, SESSION_COOKIE)).toContain('Max-Age=0');
      // Every sign-out clears the demo's re-entry cookie too.
      expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');
      await expect(store.get(id)).resolves.toBeNull();

      const calls = endSessionCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]?.method).toBe('POST');
      const form = new URLSearchParams(String(calls[0]![1]?.body));
      expect(Object.fromEntries(form)).toEqual({
        client_id: 'workbench',
        client_secret: 'shhh',
        refresh_token: 'rt-1',
      });
    });

    it.each([
      ['refuses', () => json({ error: 'invalid_grant' }, 400)],
      ['fails', () => json({}, 503)],
      ['cannot be reached', () => Promise.reject(new Error('ECONNREFUSED'))],
    ])('O4 still signs the person out here when the provider %s', async (_label, answer) => {
      const id = await signedIn();
      provider({ logout: answer });

      const response = await logout(`${SESSION_COOKIE}=${id}`);

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out`);
      expect(setCookieFor(response, SESSION_COOKIE)).toContain('Max-Age=0');
      await expect(store.get(id)).resolves.toBeNull();
    });

    it.each([
      ['a cookie that names no session', `${SESSION_COOKIE}=vanished`],
      ['no cookie at all', undefined],
    ])('O5 with %s lands on the signed-out page with the cookie cleared and asks no provider', async (_label, cookie) => {
      provider();
      const response = await logout(cookie);

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out`);
      expect(setCookieFor(response, SESSION_COOKIE)).toContain('Max-Age=0');
      expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');
      expect(endSessionCalls()).toHaveLength(0);
    });
  });
});

describe('signing out of a development session', () => {
  const bff = bffWith({ NODE_ENV: 'development' });

  async function signedIn(): Promise<string> {
    upstream.mockResolvedValueOnce(json({ accessToken: ACCESS, expiresInSeconds: 3600, tenantId: 't-1' }, 201));
    upstream.mockResolvedValueOnce(json(RECORDED, 201));
    const form = new FormData();
    form.set('tenantSlug', 'acme');
    form.set('email', 'agent@acme.test');
    const response = await bff.devSignIn(
      new Request(`${ORIGIN}/api/session/dev`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: form }),
    );
    return readCookie((response.headers.get('set-cookie') ?? '').split(';')[0], SESSION_COOKIE)!;
  }

  it('O5 deletes the record, clears the cookie and asks no provider', async () => {
    const id = await signedIn();
    const response = await bff.logout(
      new Request(`${ORIGIN}/api/session/logout`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', cookie: `${SESSION_COOKIE}=${id}` },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out`);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    // The record is what actually ends the session; the cookie is a hint.
    await expect(store.get(id)).resolves.toBeNull();
    // Two calls, both from signing in: nothing went to a provider on the way out.
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('O1 cannot be triggered from another site', async () => {
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
    upstream.mockResolvedValueOnce(json(RECORDED, 201));
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
    // Counted by destination rather than by total, because signing in now also
    // records the session: what matters is that the refused path produced no
    // request of its own.
    const proxied = upstream.mock.calls.filter((call) => !isSessionRecord(call) && String(call[0]).includes('/metrics'));
    expect(proxied).toHaveLength(0);
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

describe('the reasons the signed-out page explains', () => {
  it('names exactly the codes the callback and the demo sign-out emit (SPEC v3 §4.6.3)', () => {
    expect([...SIGN_IN_FAILURE_REASONS].sort()).toEqual(
      ['config', 'incomplete', 'no_tenant', 'parked_expired', 'provider', 'refused', 'stale'].sort(),
    );
  });

  it('gives every code a sentence of its own', () => {
    const sentences = SIGN_IN_FAILURE_REASONS.map((reason) => signInFailureSentence(reason));
    expect(new Set(sentences).size).toBe(SIGN_IN_FAILURE_REASONS.length);
    for (const sentence of sentences) {
      expect(sentence).not.toBe(GENERIC_SIGN_IN_FAILURE);
      expect(sentence).toMatch(/^[A-Z].*\.$/);
    }
    expect(signInFailureSentence('stale')).toBe('That sign-in had already been used, or it expired.');
    expect(signInFailureSentence('no_tenant')).toBe('Your account isn’t linked to a workspace yet. Ask your administrator.');
  });

  it.each([
    ['the prose an older link carried', 'that sign-in has already been used, or it expired'],
    ['markup', '<script>alert(1)</script>'],
    ['a key every object has', 'constructor'],
    ['the prototype', '__proto__'],
    ['a code in the wrong case', 'STALE'],
    ['an empty value', ''],
    ['nothing', null],
    ['undefined', undefined],
  ])('reads %s as the generic sentence, never echoing it', (_label, reason) => {
    expect(signInFailureSentence(reason)).toBe(GENERIC_SIGN_IN_FAILURE);
  });

  it('keeps the retry marker a valid __Host- cookie that lives one minute', () => {
    expect(RETRY_COOKIE).toBe('__Host-itsm-retry');
    expect(RETRY_COOKIE_SECONDS).toBe(60);
    expect(violatesHostPrefix(RETRY_COOKIE, cookieAttributes(RETRY_COOKIE_SECONDS))).toBeNull();
  });
});

/* ------------------------------------------------------------------ The demo's rows of the sign-in routes */

/**
 * The rows the demo adds to the sign-in routes (SPEC §4.5): L0 (the sign-in
 * limiter, in every mode), L1–L4, the demo's side of C5 and C9, and O2–O3,
 * with the re-entry cookie `D` cleared by every real sign-in and every
 * sign-out. The BFF here is a test app that declares itself the Service Desk
 * (`area`), as an integration test's `it-…` app does.
 */
describe('the demo’s rows of the sign-in routes', () => {
  const ISSUER = 'https://id.example.test/realms/handlers-demo';
  const DEMO_ENV = {
    NODE_ENV: 'development',
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: 'workbench',
    OIDC_CLIENT_SECRET: 'shhh',
    DEMO_MODE: 'on',
  };
  const TOKEN_ENDPOINT = `${ISSUER}/token`;
  const LIVE = {
    v: 1,
    tenantId: '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
    slug: 'demo',
    generation: 1,
    builtAt: Date.UTC(2026, 9, 2),
    anchor: Date.UTC(2026, 9, 2),
    lastResetAt: Date.UTC(2026, 9, 2),
    lastResetReason: 'scheduled',
    personas: {
      employee: { userId: 'a1000000-0000-4000-8000-000000000001' },
      agent: { userId: 'a1000000-0000-4000-8000-000000000002' },
      admin: { userId: 'a1000000-0000-4000-8000-000000000003' },
    },
    agentTeamIds: [],
  } as const;

  const demoBff = (env: Record<string, string> = {}) =>
    createBff({ ...APP, area: 'workbench' }, { TEST_ORIGIN: ORIGIN, API_BASE_URL: API, ...DEMO_ENV, ...env });

  beforeEach(() => {
    // One keyspace for sessions and tokens, as Redis is: the re-mint swaps
    // session records in place.
    setSessionStore(APP.appName, tokens.sessions);
    store = tokens.sessions;
    tokens.write(DEMO_KEYS.live, LIVE);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    upstream.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes('.well-known')) {
        return json({ ...DISCOVERY, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: TOKEN_ENDPOINT, end_session_endpoint: `${ISSUER}/logout` });
      }
      if (url.endsWith('/api/v1/auth/session')) return json(RECORDED, 201);
      if (url === `${ISSUER}/logout`) return new Response(null, { status: 204 });
      return json({ error: 'invalid_grant' }, 400);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A demo session as the mint leaves it, slid by its first page so reading it changes nothing. */
  async function demoSession(overrides: Partial<Session> = {}, id = 'demo-1'): Promise<Session> {
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
        demoGeneration: 1,
        demoSid: minted.record.sid,
        lastTouchAt: now,
        ...overrides,
      },
      900,
    );
    return (await demoBff().sessionFor(id))!;
  }

  async function realSession(overrides: Partial<Session> = {}, id = 'real-1'): Promise<Session> {
    const session: Session = {
      id,
      kind: 'oidc',
      accessToken: ACCESS,
      refreshToken: 'rt-parked',
      accessExpiresAt: Date.now() + 300_000,
      tenantId: 't-1',
      userId: 'u-1',
      displayName: 'A Person',
      createdAt: Date.now(),
      ...overrides,
    };
    await tokens.sessions.put(session, 43_200);
    return session;
  }

  function tokenExists(token: string): boolean {
    return tokens.keyspace.exists(DEMO_KEYS.token(demoTokenHash(token)));
  }

  const login = (bff: ReturnType<typeof demoBff>, query: string, headers: Record<string, string> = {}) =>
    bff.login(new Request(`${ORIGIN}/api/session/login?${query}`, { headers }));

  const today = () => `${DEMO_COOKIE}=${demoCookieValue('agent')}`;

  describe('L0, the sign-in limiter', () => {
    it.each([
      ['with the demo off', { DEMO_MODE: 'off' }],
      ['with the demo on', {}],
    ])('L0 answers the 61st sign-in in a minute from one network with 429, %s', async (_label, env) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.UTC(2026, 9, 3, 9, 15, 10));
      const bff = demoBff(env);
      const from = { 'x-forwarded-for': '203.0.113.50' };
      for (let attempt = 0; attempt < 60; attempt += 1) {
        expect((await login(bff, 'redirectTo=/overview', from)).status).toBe(302);
      }
      const refused = await login(bff, 'redirectTo=/overview', from);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('50');
      await expect(refused.json()).resolves.toMatchObject({
        type: 'https://docs.itsm.example/problems/rate_limited',
        status: 429,
        retryAfterSec: 50,
      });

      // Another network is not held back by this one.
      expect((await login(bff, 'redirectTo=/overview', { 'x-forwarded-for': '198.51.100.60' })).status).toBe(302);

      // A BFF key, not a demo one: no `demo:rl:*` key is written, and the
      // counter names a salted bucket, never the address.
      const keys = tokens.keyspace.keys();
      expect(keys.filter((key) => key.startsWith('demo:rl:'))).toEqual([]);
      const counters = keys.filter((key) => key.startsWith(`bff:${APP.appName}:rl:login:`));
      expect(counters).toHaveLength(2);
      for (const key of counters) {
        expect(key).toMatch(/^bff:test-app:rl:login:[0-9a-f]{16}:m:\d+$/);
        expect(tokens.keyspace.pttl(key)).toBeLessThanOrEqual(120_000);
        expect(tokens.keyspace.pttl(key)).toBeGreaterThan(0);
      }
      expect(keys.join('\n')).not.toContain('203.0.113.50');
    });

    it('L0 counts a fresh minute from nothing', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.UTC(2026, 9, 3, 9, 15, 59));
      const bff = demoBff();
      for (let attempt = 0; attempt < 61; attempt += 1) await login(bff, '', { 'x-forwarded-for': '203.0.113.51' });
      vi.setSystemTime(Date.UTC(2026, 9, 3, 9, 16, 0));
      expect((await login(bff, '', { 'x-forwarded-for': '203.0.113.51' })).status).toBe(302);
    });

    it('L0 lets the sign-in through when the counter cannot be reached', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setLoginCounter(APP.appName, { hit: () => Promise.reject(new Error('ECONNREFUSED')) });
      const response = await login(demoBff(), 'redirectTo=/overview');
      expect(response.status).toBe(302);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sign-in limiter could not count'));
    });
  });

  it('L1 is a real sign-in asked for by name: it clears the re-entry cookie and goes to the provider, whatever else the link says', async () => {
    const response = await login(demoBff(), 'account=1&demo=1&redirectTo=/tickets', { cookie: today() });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).origin + new URL(response.headers.get('location')!).pathname).toBe(`${ISSUER}/auth`);
    expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');
  });

  it('L2 sends a browser already in today’s demo straight on', async () => {
    const session = await demoSession();
    const response = await login(demoBff(), 'demo=1&redirectTo=/tickets/INC-0042', { cookie: `${SESSION_COOKIE}=${session.id}` });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tickets/INC-0042`);
  });

  it('L3 sends a demo client to /demo, never to the identity provider', async () => {
    const response = await login(demoBff(), 'demo=1&redirectTo=/tickets/INC-0042');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-0042&resumed=1`);
    expect(upstream.mock.calls.some((call) => String(call[0]).includes('.well-known'))).toBe(false);
  });

  it('L3 also for a demo session a generation behind: /demo decides, the provider is never asked', async () => {
    const session = await demoSession();
    tokens.write(DEMO_KEYS.live, { ...LIVE, generation: 2 });
    const response = await login(demoBff(), 'demo=1', { cookie: `${SESSION_COOKIE}=${session.id}` });
    // Reading the session slid nothing (not due) and the generation moved on:
    // not `S:demo✓`, so L3.
    expect(new URL(response.headers.get('location')!).pathname).toBe('/demo');
  });

  it('L4 offers the demo back to a browser that was in it today, through the chooser', async () => {
    const response = await login(demoBff(), 'redirectTo=/tickets', { cookie: today() });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?redirectTo=%2Ftickets`);
  });

  it('L4 ignores yesterday’s re-entry cookie, and another app’s, and goes to the provider', async () => {
    for (const cookie of [`${DEMO_COOKIE}=agent.2020-01-01`, `${DEMO_COOKIE}=${demoCookieValue('employee')}`]) {
      const response = await login(demoBff(), 'redirectTo=/tickets', { cookie });
      expect(new URL(response.headers.get('location')!).origin).toBe('https://id.example.test');
    }
  });

  it('L2–L4 do not apply with the demo off: demo=1 and the cookie are ignored', async () => {
    const response = await login(demoBff({ DEMO_MODE: 'off' }), 'demo=1&redirectTo=/tickets', { cookie: today() });
    expect(new URL(response.headers.get('location')!).origin).toBe('https://id.example.test');
  });

  it('C5 does not count a demo session as a person already signed in: the stale callback restarts (C6)', async () => {
    const session = await demoSession();
    const response = await demoBff().callback(
      new Request(`${ORIGIN}/api/session/callback?code=abc&state=invented`, { headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
    );
    expect(response.headers.get('location')).toBe(`${ORIGIN}/api/session/login?redirectTo=%2Fqueue`);
  });

  it('C9 revokes the demo session a real sign-in replaces, and clears the re-entry cookie', async () => {
    const session = await demoSession();
    const bff = demoBff();
    const started = await login(bff, 'account=1&redirectTo=/tickets');
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    upstream.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url === TOKEN_ENDPOINT) return json({ access_token: ACCESS, refresh_token: 'rt', expires_in: 300 });
      if (url.endsWith('/api/v1/auth/session')) return json(RECORDED, 201);
      return json({}, 404);
    });
    const response = await bff.callback(
      new Request(`${ORIGIN}/api/session/callback?code=abc&state=${state}`, { headers: { cookie: `${SESSION_COOKIE}=${session.id}; ${today()}` } }),
    );
    expect(response.headers.get('location')).toBe(`${ORIGIN}/tickets`);
    expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');
    await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
    expect(tokenExists(session.accessToken)).toBe(false);
    const id = readCookie(setCookieFor(response, SESSION_COOKIE)?.split(';')[0], SESSION_COOKIE)!;
    await expect(tokens.sessions.get(id)).resolves.toMatchObject({ kind: 'oidc' });
  });

  describe('signing out of a demo', () => {
    const logout = (bff: ReturnType<typeof demoBff>, cookie: string) =>
      bff.logout(new Request(`${ORIGIN}/api/session/logout`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', cookie } }));

    it('O2 hands back the parked provider session once a refresh proves it still works', async () => {
      const real = await realSession();
      const session = await demoSession({ parkedSessionId: real.id });
      const fresh = token({ tenant_id: 't-1', itsm_user_id: 'u-1', name: 'A Person' });
      upstream.mockImplementation(async (input: string) => {
        const url = String(input);
        if (url === TOKEN_ENDPOINT) return json({ access_token: fresh, refresh_token: 'rt-new', expires_in: 300 });
        if (url.endsWith('/api/v1/auth/session')) return json(RECORDED, 201);
        return json({}, 404);
      });

      const response = await logout(demoBff(), `${SESSION_COOKIE}=${session.id}`);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out?demo=1&restored=1`);
      const restored = setCookieFor(response, SESSION_COOKIE)!;
      expect(restored.split(';')[0]).toBe(`${SESSION_COOKIE}=${real.id}`);
      expect(restored).toContain('Max-Age=43200');
      expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');

      await expect(tokens.sessions.get(real.id)).resolves.toMatchObject({ kind: 'oidc', accessToken: fresh, refreshToken: 'rt-new' });
      await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
      expect(tokenExists(session.accessToken)).toBe(false);
      // The demo never asks the provider to end anything.
      expect(upstream.mock.calls.some((call) => String(call[0]).endsWith('/logout'))).toBe(false);
    });

    it('O2 says the parked sign-in expired, and links a real sign-in, when its refresh is refused', async () => {
      const real = await realSession();
      const session = await demoSession({ parkedSessionId: real.id });
      const response = await logout(demoBff(), `${SESSION_COOKIE}=${session.id}`);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out?demo=1&reason=parked_expired`);
      expect(setCookieFor(response, SESSION_COOKIE)).toContain('Max-Age=0');
      expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');
      await expect(tokens.sessions.get(real.id)).resolves.toBeNull();
      await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
      expect(signInFailureSentence('parked_expired')).toBe('Your account’s sign-in expired while you explored; sign in again.');
    });

    it('O2 hands back a parked development session while its token is good', async () => {
      const real = await realSession({ kind: 'dev', refreshToken: null });
      const session = await demoSession({ parkedSessionId: real.id });
      const response = await logout(demoBff(), `${SESSION_COOKIE}=${session.id}`);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out?demo=1&restored=1`);
      expect(setCookieFor(response, SESSION_COOKIE)!.split(';')[0]).toBe(`${SESSION_COOKIE}=${real.id}`);
    });

    it('O2 does not hand back a parked session after twelve hours: that is O3', async () => {
      const real = await realSession();
      const session = await demoSession({ parkedSessionId: real.id, createdAt: Date.now() - 12 * 3_600_000 });
      const response = await logout(demoBff(), `${SESSION_COOKIE}=${session.id}`);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out?demo=1`);
    });

    it('O3 ends a demo visit: the token is revoked, both cookies cleared, and no provider is asked', async () => {
      const session = await demoSession();
      const response = await logout(demoBff(), `${SESSION_COOKIE}=${session.id}`);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/signed-out?demo=1`);
      expect(setCookieFor(response, SESSION_COOKIE)).toContain('Max-Age=0');
      expect(setCookieFor(response, DEMO_COOKIE)).toContain('Max-Age=0');
      await expect(tokens.sessions.get(session.id)).resolves.toBeNull();
      expect(tokenExists(session.accessToken)).toBe(false);
      expect(upstream.mock.calls.some((call) => String(call[0]).startsWith(ISSUER))).toBe(false);
    });

    it('O1 refuses a demo sign-out posted from another site and keeps the visit', async () => {
      const session = await demoSession();
      const response = await demoBff().logout(
        new Request(`${ORIGIN}/api/session/logout`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', cookie: `${SESSION_COOKIE}=${session.id}` } }),
      );
      expect(response.status).toBe(403);
      expect(setCookies(response)).toEqual([]);
      expect(tokenExists(session.accessToken)).toBe(true);
    });
  });
});
