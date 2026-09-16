import { createClient, type Client } from '@itsm/sdk';
import {
  developmentSignInAvailable,
  readConfig,
  type AppIdentity,
  type BffConfig,
  type Environment,
} from './config.js';
import { clearedAttributes, cookieAttributes, readCookie, serialiseCookie, SESSION_COOKIE } from './cookies.js';
import { createSession, SessionRefused } from './create-session.js';
import { devSignIn, DevSignInFailed } from './dev-sign-in.js';
import {
  authorisationUrl,
  challengeFor,
  createVerifier,
  discover,
  endSessionUrl,
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

const PENDING_TTL_SECONDS = 600;

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

  const redirect = (location: string, status: 302 | 303 = 303, cookie?: string): Response =>
    new Response(null, {
      status,
      headers: cookie ? { location, 'set-cookie': cookie } : { location },
    });

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
        // No provider configured. In development that is the form; anywhere
        // else `readConfig` has already refused to start, so this is
        // unreachable.
        const target = developmentSignInAvailable(config) ? config.signInPath : config.signedOutPath;
        return redirect(
          new URL(`${target}?redirectTo=${encodeURIComponent(redirectTo)}`, config.appOrigin).toString(),
          302,
        );
      }

      const verifier = createVerifier();
      const state = newState();
      const store = await sessionStore(config);
      await store.putPending(state, { verifier, redirectTo, createdAt: Date.now() }, PENDING_TTL_SECONDS);

      const discovery = await discover(config.oidc);
      const idp = url.searchParams.get('idp');
      return redirect(
        authorisationUrl(discovery.authorization_endpoint, config.oidc, {
          state,
          challenge: challengeFor(verifier),
          redirectUri: redirectUriFor(config.appOrigin),
          ...(idp ? { idpHint: idp } : {}),
        }),
        302,
      );
    },

    async callback(request) {
      const config = settings();
      const params = new URL(request.url).searchParams;
      const failure = (reason: string): Response =>
        redirect(
          new URL(`${config.signedOutPath}?reason=${encodeURIComponent(reason)}`, config.appOrigin).toString(),
          302,
        );

      // The provider reports its own refusals here — a cancelled consent
      // screen, a disabled account. Its `error_description` is not echoed
      // back: it is the provider's prose about our client, not a message for
      // this person.
      if (params.get('error')) return failure('the identity provider did not complete the sign-in');

      const code = params.get('code');
      const state = params.get('state');
      if (!code || !state) return failure('that sign-in link is incomplete');
      if (!config.oidc) return failure('this deployment has no identity provider configured');

      // Single use: a second visit to the same callback URL — a refresh, a
      // back button, a replayed link — finds nothing and fails here rather
      // than exchanging the code twice.
      const store = await sessionStore(config);
      const pending = await store.takePending(state);
      if (!pending) return failure('that sign-in has already been used, or it expired');

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

        return redirect(
          new URL(safeRedirectTarget(pending.redirectTo, config.defaultLanding), config.appOrigin).toString(),
          302,
          serialiseCookie(SESSION_COOKIE, session.id, cookieAttributes(config.sessionTtlSeconds)),
        );
      } catch (error) {
        if (error instanceof SignInFailed || error instanceof SessionRefused) return failure(error.message);
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

      // The server-side record goes first. If the provider's end-session
      // redirect then fails, the person is signed out of this app regardless,
      // which is the order that fails safe.
      const id = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
      if (id) {
        const store = await sessionStore(config);
        await store.delete(id);
      }

      let destination = postLogoutUriFor(config.appOrigin, config.signedOutPath);
      if (config.oidc) {
        try {
          // Ending the provider's session too: without this, "sign out" on a
          // shared machine leaves the next person one redirect away from the
          // previous person's account.
          destination = endSessionUrl(await discover(config.oidc), null, destination) ?? destination;
        } catch {
          // A provider that cannot be reached must not stop a sign-out.
        }
      }

      return redirect(destination, 303, serialiseCookie(SESSION_COOKIE, '', clearedAttributes()));
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
        return redirect(
          new URL(redirectTo, config.appOrigin).toString(),
          303,
          serialiseCookie(SESSION_COOKIE, session.id, cookieAttributes(config.sessionTtlSeconds)),
        );
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
          response.headers.set('set-cookie', serialiseCookie(SESSION_COOKIE, '', clearedAttributes()));
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
