import { createClient, type Client } from '@itsm/sdk';
import {
  developmentSignInAvailable,
  readConfig,
  type AppIdentity,
  type BffConfig,
  type Environment,
} from './config.js';
import {
  clearedAttributes,
  cookieAttributes,
  readCookie,
  RETRY_COOKIE,
  RETRY_COOKIE_SECONDS,
  serialiseCookie,
  SESSION_COOKIE,
  type SignInFailureReason,
} from './cookies.js';
import { createSession, SessionRefused } from './create-session.js';
import { recordSession } from './record-session.js';
import { devSignIn, DevSignInFailed } from './dev-sign-in.js';
import {
  authorisationUrl,
  challengeFor,
  createVerifier,
  discover,
  endProviderSession,
  exchangeCode,
  readClaims,
  refreshTokens,
  SignInFailed,
} from './oidc.js';
import {
  assertMethodAllowed,
  assertSameOrigin,
  forwardRequestHeaders,
  forwardResponseHeaders,
  ProxyRefused,
  refusalBody,
  targetPathFor,
} from './proxy.js';
import { safeRedirectTarget } from './redirects.js';
import { needsRefresh, newCorrelationId, newState, type Session } from './session.js';
import { sessionStore } from './store.js';
import { postLogoutUriFor, redirectUriFor } from './urls.js';

/**
 * A backend-for-frontend, as five request handlers and a session reader.
 *
 * Written against `Request` and `Response` rather than against a framework's
 * own types, so a route handler in any of the applications is three lines and
 * so the handlers can be tested without standing one up. Next's route handlers
 * return a plain `Response`, which is what makes this possible at all.
 *
 * Doc 08 §9: the BFF does exactly two things — exchange the session for a
 * bearer token, and pass the request on unchanged. Everything below is one of
 * those two, or the sign-in that produces the session in the first place.
 */

/**
 * How long a sign-in may sit on the provider's login page and still finish.
 *
 * Matches Keycloak's `accessCodeLifespanLogin` (1,800 s, set explicitly in the
 * realm). At 600 s, somebody who opened the login page, took a phone call and
 * came back after ten minutes typed a correct password and was told the
 * sign-in had expired, because this side had forgotten it while the provider
 * still honoured it.
 */
const PENDING_TTL_SECONDS = 1800;

/** This app's own login route; the stale-callback restart (C6) goes back through it. */
const LOGIN_PATH = '/api/session/login';

/**
 * The longest `login_hint` passed on to the provider: 254 characters is the
 * longest address SMTP can carry (RFC 5321), so anything longer is not an
 * address and is dropped rather than truncated into a different one.
 */
const LOGIN_HINT_MAX_LENGTH = 254;

/**
 * A `login_hint` worth forwarding, or nothing.
 *
 * The hint pre-fills the provider's username field, so it arrives from a link
 * and lands in somebody else's form: an address of a sane length, with no
 * whitespace and no control characters (which would otherwise travel through
 * the authorisation URL into the provider's page and logs), and exactly one
 * `@` with something either side. Anything else is dropped — the sign-in
 * works the same without it, the person types their address.
 */
function loginHintFrom(value: string | null): string | null {
  if (!value || value.length > LOGIN_HINT_MAX_LENGTH) return null;
  const control = (code: number): boolean => code < 0x20 || (code >= 0x7f && code <= 0x9f);
  if ([...value].some((character) => control(character.codePointAt(0) ?? 0))) return null;
  return /^[^\s@]+@[^\s@]+$/.test(value) ? value : null;
}

/**
 * Next extends `RequestInit` with `cache`; Node's own fetch types do not, and
 * this package is deliberately typed against Node's. Spelled out rather than
 * cast away, so the extension is visible to whoever reads it next.
 */
type FetchInit = RequestInit & { cache?: 'no-store' | 'force-cache' };

export interface Bff {
  readonly config: BffConfig;
  /** `GET /api/session/login` */
  login(request: Request): Promise<Response>;
  /** `GET /api/session/callback` */
  callback(request: Request): Promise<Response>;
  /** `POST /api/session/logout` */
  logout(request: Request): Promise<Response>;
  /** `POST /api/session/dev`, 404 unless there is genuinely no identity provider. */
  devSignIn(request: Request): Promise<Response>;
  /** `ALL /api/proxy/[...path]` */
  proxy(request: Request, segments: readonly string[]): Promise<Response>;
  /** The session behind a cookie value, refreshed if it is close to expiring. */
  sessionFor(cookieValue: string | undefined): Promise<Session | null>;
  /** An SDK client bound to a session, for server components. */
  clientFor(session: Session, correlationId?: string): Client;
  /** Whether the development sign-in form should exist. */
  developmentSignInAvailable(): boolean;
}

export function createBff(app: AppIdentity, env: Environment = process.env): Bff {
  /**
   * Read on first use, not at import.
   *
   * `readConfig` refuses a production environment with no identity provider,
   * which is the guard that matters — but a Next build imports every route
   * module to collect its configuration, with `NODE_ENV` already set to
   * production and none of the deployment's environment present. Reading
   * eagerly makes the application fail to *build* on a machine that was never
   * going to run it, which is a different thing from failing to start.
   */
  let cached: BffConfig | null = null;
  const settings = (): BffConfig => (cached ??= readConfig(app, env));

  /**
   * A redirect, with any number of cookies.
   *
   * An array rather than one optional string because a response can need two
   * `Set-Cookie` headers — a successful callback sets the session and clears
   * the retry marker, and the demo sign-in sets the session and the re-entry
   * cookie — and two cookies folded into one header with a comma is a header
   * no browser reads back as two. `Headers.append` keeps them separate.
   */
  const redirect = (location: string, status: 302 | 303 = 303, cookies: readonly string[] = []): Response => {
    const headers = new Headers({ location });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(null, { status, headers });
  };

  /** Absolute, on this app's origin: a redirect target never comes from a request header. */
  const here = (path: string): string => new URL(path, settings().appOrigin).toString();

  const sessionCookie = (id: string): string =>
    serialiseCookie(SESSION_COOKIE, id, cookieAttributes(settings().sessionTtlSeconds));
  const clearedSessionCookie = (): string => serialiseCookie(SESSION_COOKIE, '', clearedAttributes());
  const retryCookie = (): string => serialiseCookie(RETRY_COOKIE, '1', cookieAttributes(RETRY_COOKIE_SECONDS));
  const clearedRetryCookie = (): string => serialiseCookie(RETRY_COOKIE, '', clearedAttributes());

  /**
   * `/signed-out` with a reason code (SPEC §4.6.3). Typed to the codes the page
   * knows, so a reason this side invents without a sentence on the other side
   * fails to compile rather than showing the generic line.
   */
  const signInFailed = (reason: SignInFailureReason, cookies: readonly string[] = []): Response =>
    redirect(here(`${settings().signedOutPath}?reason=${reason}`), 302, cookies);

  const problem = (status: number, title: string, detail: string, correlationId: string): Response =>
    new Response(JSON.stringify({ type: 'about:blank', title, status, detail, correlationId }), {
      status,
      headers: { 'content-type': 'application/problem+json' },
    });

  async function sessionFor(cookieValue: string | undefined): Promise<Session | null> {
    if (!cookieValue) return null;
    const config = settings();

    const store = await sessionStore(config);
    const session = await store.get(cookieValue);
    if (!session) return null;
    if (!needsRefresh(session)) return session;

    // Without a provider there is nothing to refresh against: the development
    // token simply expires, and the person signs in again. Saying so here is
    // better than a refresh path that silently does nothing.
    if (!config.oidc || !session.refreshToken) {
      await store.delete(session.id);
      return null;
    }

    try {
      const tokens = await refreshTokens(config.oidc, session.refreshToken);
      const claims = readClaims(tokens.accessToken);
      const refreshed: Session = {
        ...session,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? session.refreshToken,
        accessExpiresAt: Date.now() + tokens.expiresInSeconds * 1000,
        displayName: claims.displayName ?? session.displayName,
      };
      await store.put(refreshed, config.sessionTtlSeconds);

      // Again on every refresh, not only at sign-in. Two things come of it:
      // `last_seen_at` means what it says on the "your sessions" screen, and a
      // record that could not be written when the person signed in is written
      // now — so the window in which a session cannot be revoked is one refresh
      // interval rather than the whole of its life.
      await recordSession(config, refreshed.accessToken);

      return refreshed;
    } catch {
      // A refused refresh means the provider has ended the session — because
      // the person signed out elsewhere, or an administrator revoked it.
      // Dropping the record here is what makes that take effect in this app.
      await store.delete(session.id);
      return null;
    }
  }

  return {
    get config() {
      return settings();
    },

    developmentSignInAvailable: () => developmentSignInAvailable(settings()),

    async login(request) {
      const config = settings();
      const url = new URL(request.url);
      const redirectTo = safeRedirectTarget(url.searchParams.get('redirectTo'), config.defaultLanding);

      if (!config.oidc) {
        // L5: no provider configured. In development that is the form;
        // anywhere else `readConfig` has already refused to start, so the
        // second branch is unreachable — and says why if it ever is not.
        if (!developmentSignInAvailable(config)) return signInFailed('config');
        return redirect(here(`${config.signInPath}?redirectTo=${encodeURIComponent(redirectTo)}`), 302);
      }

      // L6: the pending record lives as long as the provider's login page.
      const verifier = createVerifier();
      const state = newState();
      const store = await sessionStore(config);
      await store.putPending(state, { verifier, redirectTo, createdAt: Date.now() }, PENDING_TTL_SECONDS);

      const discovery = await discover(config.oidc);
      const idp = url.searchParams.get('idp');
      const loginHint = loginHintFrom(url.searchParams.get('login_hint'));
      return redirect(
        authorisationUrl(discovery.authorization_endpoint, config.oidc, {
          state,
          challenge: challengeFor(verifier),
          redirectUri: redirectUriFor(config.appOrigin),
          ...(loginHint ? { loginHint } : {}),
          ...(idp ? { idpHint: idp } : {}),
        }),
        302,
      );
    },

    async callback(request) {
      const config = settings();
      const params = new URL(request.url).searchParams;

      // The provider reports its own refusals here — a cancelled consent
      // screen, a disabled account. Its `error_description` is not echoed
      // back: it is the provider's prose about our client, not a message for
      // this person, so only a code travels to the page.
      const error = params.get('error');
      if (error === 'login_required' || error === 'interaction_required') {
        // C1: what a `prompt=none` hop answers when there is no provider
        // session. This app never sends `prompt=none` today; the row is here
        // so that adopting it later is one line, not a new failure mode.
        return redirect(here(`${config.signInPath}?redirectTo=${encodeURIComponent(config.defaultLanding)}`), 302);
      }
      if (error) return signInFailed('provider'); // C2

      const code = params.get('code');
      const state = params.get('state');
      if (!code || !state) return signInFailed('incomplete'); // C3
      if (!config.oidc) return signInFailed('config'); // C4

      // Single use: a second visit to the same callback URL — a refresh, a
      // back button, a replayed link — finds nothing here, and no code is ever
      // exchanged twice. What a miss means is decided below.
      const store = await sessionStore(config);
      const pending = await store.takePending(state);
      if (!pending) {
        const cookies = request.headers.get('cookie');
        // C5: Back pressed straight after signing in. The person is signed
        // in; the right answer is the app, not an error about a link they
        // never knowingly reused.
        if (await sessionFor(readCookie(cookies, SESSION_COOKIE))) {
          return redirect(here(config.defaultLanding), 302, [clearedRetryCookie()]);
        }
        // C7: the one silent retry has already been spent. Stop, and say so.
        if (readCookie(cookies, RETRY_COOKIE) !== undefined) {
          return signInFailed('stale', [clearedRetryCookie()]);
        }
        // C6: start again once. Under the provider's single sign-on the round
        // trip comes straight back with a fresh code, so a login page left
        // open too long, or a Back press, ends signed in rather than on an
        // error page. The marker makes it once.
        return redirect(
          here(`${LOGIN_PATH}?redirectTo=${encodeURIComponent(config.defaultLanding)}`),
          302,
          [retryCookie()],
        );
      }

      try {
        const tokens = await exchangeCode(config.oidc, {
          code,
          verifier: pending.verifier,
          redirectUri: redirectUriFor(config.appOrigin),
        });
        const session = await createSession(config, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresInSeconds: tokens.expiresInSeconds,
        });

        // C9: signed in. The retry marker is cleared too, so the next stale
        // callback, however soon, gets its own silent retry.
        return redirect(here(safeRedirectTarget(pending.redirectTo, config.defaultLanding)), 302, [
          sessionCookie(session.id),
          clearedRetryCookie(),
        ]);
      } catch (error) {
        // C8: a token that names no tenant is a provider set up without the
        // mapper, which an administrator can fix; any other refusal is the
        // provider's to explain, not ours to guess at.
        if (error instanceof SessionRefused) return signInFailed('no_tenant');
        if (error instanceof SignInFailed) return signInFailed('refused');
        throw error;
      }
    },

    async logout(request) {
      const config = settings();
      try {
        assertSameOrigin('POST', request.headers, config.appOrigin);
      } catch (error) {
        if (error instanceof ProxyRefused) return problem(403, 'Forbidden', error.message, newCorrelationId());
        throw error;
      }

      // The server-side record goes first, read once for its refresh token
      // and then deleted. If the provider then fails, the person is signed
      // out of this app regardless, which is the order that fails safe.
      const id = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
      let refreshToken: string | null = null;
      if (id) {
        const store = await sessionStore(config);
        refreshToken = (await store.get(id))?.refreshToken ?? null;
        await store.delete(id);
      }

      // O4: a provider session is ended over the back channel, so the browser
      // never leaves this origin — the hop to the provider's end-session page
      // is what Chromium blocked under `form-action 'self'`, and what showed
      // the provider's own error and confirmation pages to everybody else.
      // Without this, "sign out" on a shared machine leaves the next person
      // one redirect away from the previous person's account. Bounded at 3 s
      // and never throws.
      //
      // O5: a development session, a cookie naming nothing, or no cookie has
      // no provider session this side can name, so there is nothing to end
      // there. (A provider session can outlive a record that has already
      // expired here: ending it needs the refresh token that record held, and
      // a record that is gone holds none.)
      if (config.oidc && refreshToken) await endProviderSession(config.oidc, refreshToken);

      return redirect(postLogoutUriFor(config.appOrigin, config.signedOutPath), 303, [clearedSessionCookie()]);
    },

    async devSignIn(request) {
      const config = settings();
      // Answers 404 unless there is genuinely no identity provider and the
      // environment is not production — the same condition the API applies to
      // the endpoint this calls, checked on both sides because each is a
      // deployment unit of its own and either could be configured wrongly.
      if (!developmentSignInAvailable(config)) {
        return problem(404, 'Not Found', 'no development sign-in here', newCorrelationId());
      }

      try {
        assertSameOrigin('POST', request.headers, config.appOrigin);
      } catch (error) {
        if (error instanceof ProxyRefused) return problem(403, 'Forbidden', error.message, newCorrelationId());
        throw error;
      }

      const form = await request.formData();
      const tenantSlug = String(form.get('tenantSlug') ?? '').trim();
      const email = String(form.get('email') ?? '').trim();
      const redirectTo = safeRedirectTarget(String(form.get('redirectTo') ?? ''), config.defaultLanding);

      const back = (reason: string): Response =>
        redirect(
          new URL(
            `${config.signInPath}?reason=${encodeURIComponent(reason)}&redirectTo=${encodeURIComponent(redirectTo)}`,
            config.appOrigin,
          ).toString(),
        );

      if (!tenantSlug || !email) return back('A tenant and an email address are both needed.');

      try {
        const tokens = await devSignIn(config, { tenantSlug, email });
        const session = await createSession(config, tokens);
        return redirect(new URL(redirectTo, config.appOrigin).toString(), 303, [sessionCookie(session.id)]);
      } catch (error) {
        if (error instanceof DevSignInFailed || error instanceof SessionRefused) return back(error.message);
        throw error;
      }
    },

    async proxy(request, segments) {
      const config = settings();
      const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();

      try {
        assertMethodAllowed(request.method);
        assertSameOrigin(request.method, request.headers, config.appOrigin);

        const target = targetPathFor(segments);
        const session = await sessionFor(readCookie(request.headers.get('cookie'), SESSION_COOKIE));

        if (!session) {
          // 401 rather than a redirect: the caller is `fetch` from a
          // component, and a redirect to an HTML sign-in page arrives as a
          // JSON parse error. The cookie is cleared on the way out so the
          // browser stops sending an identifier that names nothing.
          const response = problem(401, 'Unauthorized', 'that session has ended', correlationId);
          response.headers.set('set-cookie', clearedSessionCookie());
          return response;
        }

        const search = new URL(request.url).search;
        const upstream = await fetch(`${config.apiBaseUrl}${target}${search}`, {
          method: request.method,
          headers: forwardRequestHeaders(request.headers, session.accessToken, correlationId),
          // GET and HEAD carry no body, and passing one is a runtime error
          // rather than an empty request.
          ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
          // A redirect from the API is a fact about the API, not something to
          // follow on the caller's behalf behind its back.
          redirect: 'manual',
          cache: 'no-store',
        } as FetchInit);

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: forwardResponseHeaders(upstream.headers),
        });
      } catch (error) {
        if (error instanceof ProxyRefused) {
          const body = refusalBody(error, correlationId);
          return new Response(JSON.stringify(body), {
            status: error.status,
            headers: { 'content-type': 'application/problem+json' },
          });
        }
        // An API that is down is a 502 from here, not a 500: this application
        // is working, its dependency is not, and the two need different
        // responses from whoever is on call.
        return problem(502, 'Bad Gateway', 'the API could not be reached', correlationId);
      }
    },

    sessionFor,

    clientFor(session, correlationId = newCorrelationId()) {
      return createClient({
        baseUrl: settings().apiBaseUrl,
        token: session.accessToken,
        correlationId,
        // Server components render during a request, and Next's fetch caches
        // by default. A queue that shows yesterday's tickets because the
        // framework was being helpful is worse than a slow queue.
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' } as FetchInit),
      });
    },
  };
}
