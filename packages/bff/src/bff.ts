import { createClient, type Client } from '@itsm/sdk';
import { DEMO_PROBLEM_CODES, demoEntryHref, demoPersonaForArea, isDemoArea, type DemoArea } from '@itsm/contracts/demo';
import {
  developmentSignInAvailable,
  readConfig,
  type AppIdentity,
  type BffConfig,
  type Environment,
} from './config.js';
import {
  clearedAttributes,
  clearedDemoCookie,
  cookieAttributes,
  demoCookie,
  readCookie,
  readDemoReentry,
  RETRY_COOKIE,
  RETRY_COOKIE_SECONDS,
  serialiseCookie,
  SESSION_COOKIE,
  type SignInFailureReason,
} from './cookies.js';
import { createSession, SessionRefused } from './create-session.js';
import { createDemoHandlers, loginLimit, type DemoEntryRequest, type SignInPageRequest } from './demo/handlers.js';
import type { DemoEntryDecision, SignInDecision } from './demo/entry.js';
import { endDemoVisit, latestSession, parkedSessionFor, remintOnce } from './demo/remint.js';
import { demoTokenStore } from './demo/store.js';
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
  codedProblemBody,
  forwardRequestHeaders,
  forwardResponseHeaders,
  problemCodeOf,
  ProxyRefused,
  refusalBody,
  targetPathFor,
} from './proxy.js';
import { safeRedirectTarget } from './redirects.js';
import {
  isDemoSession,
  isRealSession,
  needsRefresh,
  newCorrelationId,
  newState,
  type DemoSession,
  type Session,
  type SessionStore,
} from './session.js';
import { sessionStore } from './store.js';
import { postLogoutUriFor, redirectUriFor } from './urls.js';

/**
 * A backend-for-frontend, as request handlers and a session reader.
 *
 * Written against `Request` and `Response` rather than against a framework's
 * own types, so a route handler in any of the applications is three lines and
 * so the handlers can be tested without standing one up. Next's route handlers
 * return a plain `Response`, which is what makes this possible at all.
 *
 * Doc 08 §9: the BFF does exactly two things — exchange the session for a
 * bearer token, and pass the request on unchanged. Everything below is one of
 * those two, or the sign-in that produces the session in the first place.
 *
 * Since v3 a session has a kind (SPEC §4.5): a provider sign-in, the
 * development form, or a demo visit with a minted `itsmdemo_` token. The
 * sign-in state machine is one table for all three, and every row of it —
 * L0–L6, C1–C9, O1–O5, F1–F9, M1–M7, P1–P8, X1–X8, T1–T6 — is a test whose
 * name starts with its id. Its invariants: no GET ever mints; a demo visitor
 * never reaches the identity provider; a third-party page cannot silently put
 * a browser into the demo; a real sign-in always wins; every unsafe route
 * checks the origin.
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

/** F8: a token with less than this left when its re-mint is refused is not worth keeping. */
const KEEP_WITHOUT_REMINT_MS = 60_000;

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
  /** `POST /api/session/demo`, 404 unless `DEMO_MODE=on` here. */
  demoSignIn(request: Request): Promise<Response>;
  /** `GET /api/demo/status`, 404 unless `DEMO_MODE=on` here. */
  demoStatus(request: Request): Promise<Response>;
  /** `POST /api/demo/reset`, 404 unless `DEMO_MODE=on` here. */
  demoReset(request: Request): Promise<Response>;
  /** `GET /api/demo/ip-check`: the caller's own salted bucket, nothing else. */
  demoIpCheck(request: Request): Promise<Response>;
  /** What `GET /demo` shows for this request (P rows). */
  demoEntry(input: DemoEntryRequest): Promise<DemoEntryDecision>;
  /** What `GET /sign-in` shows (I rows). */
  signInPage(input: SignInPageRequest): SignInDecision;
  /** `ALL /api/proxy/[...path]` */
  proxy(request: Request, segments: readonly string[]): Promise<Response>;
  /** The session behind a cookie value, refreshed or re-minted if it is close to expiring. */
  sessionFor(cookieValue: string | undefined): Promise<Session | null>;
  /**
   * The session a re-mint replaced `session` with in the last ten seconds,
   * else `session`. A layout passes `latestSession(session).demoGeneration`
   * to the demo bar, so the bar names the generation the page is reading.
   */
  latestSession(session: Session): Session;
  /** An SDK client bound to a session, for server components. */
  clientFor(session: Session, correlationId?: string): Client;
  /** Whether the development sign-in form should exist. */
  developmentSignInAvailable(): boolean;
}

/**
 * An application's identity. `area` names which of the three areas it is,
 * for a BFF whose `appName` is not the area's own (an integration test's
 * `it-…` name); the three apps' names are their areas.
 */
export type BffIdentity = AppIdentity & { readonly area?: DemoArea };

export function createBff(app: BffIdentity, env: Environment = process.env): Bff {
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
  const area: DemoArea | null = app.area ?? (isDemoArea(app.appName) ? app.appName : null);

  /**
   * A redirect, with any number of cookies.
   *
   * An array rather than one optional string because a response can need two
   * `Set-Cookie` headers — a successful callback sets the session and clears
   * the retry marker, and the demo sign-in sets the session and the re-entry
   * cookie — and two cookies folded into one header with a comma is a header
   * no browser reads back as two. `Headers.append` keeps them separate.
   */
  const redirect = (location: string, status: 302 | 303 | 307 = 303, cookies: readonly string[] = []): Response => {
    const headers = new Headers({ location });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(null, { status, headers });
  };

  /** Absolute, on this app's origin: a redirect target never comes from a request header. */
  const here = (path: string): string => new URL(path, settings().appOrigin).toString();

  const sessionCookie = (id: string, maxAgeSeconds: number = settings().sessionTtlSeconds): string =>
    serialiseCookie(SESSION_COOKIE, id, cookieAttributes(maxAgeSeconds));
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

  /**
   * Whether a demo session is "this app's, of the live generation" (`S:demo✓`).
   * A session of an older generation is still a session — the next API call
   * re-mints it — but it is not a reason to skip `/demo` or a login.
   */
  async function isCurrentDemo(session: Session | null): Promise<boolean> {
    const config = settings();
    if (!isDemoSession(session) || area === null || config.demo === null) return false;
    if (session.persona !== demoPersonaForArea(area).key) return false;
    const { live } = await (await demoTokenStore(config)).readStatusRecords();
    return live !== null && live.generation === session.demoGeneration;
  }

  /**
   * F2–F5: a provider or development session, refreshed when it is close to
   * expiring. Unchanged from before sessions had a kind, except that only a
   * provider session is ever refreshed.
   */
  async function realSessionFor(session: Session, store: SessionStore): Promise<Session | null> {
    const config = settings();
    if (!needsRefresh(session)) return session; // F2

    // F5, and F4 without a provider: a development token simply expires, and
    // the person signs in again. Saying so here is better than a refresh path
    // that silently does nothing.
    if (session.kind !== 'oidc' || !config.oidc || !session.refreshToken) {
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

      return refreshed; // F3
    } catch {
      // F4: a refused refresh means the provider has ended the session —
      // because the person signed out elsewhere, or an administrator revoked
      // it. Dropping the record here is what makes that take effect in this app.
      await store.delete(session.id);
      return null;
    }
  }

  /** A visit that ended by itself (F6, F7, an F8 that cannot continue): its parked session, if any, comes back. */
  async function visitEnded(session: DemoSession, store: SessionStore, now: number): Promise<Session | null> {
    const config = settings();
    const after = await endDemoVisit({ config, sessions: store, tokens: await demoTokenStore(config), session, now });
    return isRealSession(after) ? realSessionFor(after, store) : null;
  }

  /**
   * F6–F9: a demo session. Never refreshed through the provider and never
   * recorded with the API; its token is re-minted instead — once on the first
   * page after the mint, which slides it from its fifteen-minute first life
   * to the full one (Y-B1), and again at half-life.
   */
  async function demoSessionFor(session: DemoSession, store: SessionStore): Promise<Session | null> {
    const config = settings();
    const demo = config.demo;
    const now = Date.now();
    if (demo === null) return visitEnded(session, store, now); // F6
    if (now - session.createdAt >= demo.sessionMaxSeconds * 1000) return visitEnded(session, store, now); // F7

    const tokens = await demoTokenStore(config);
    const ttl = demo.tokenTtlSeconds * 1000;
    const left = session.accessExpiresAt - now;
    // Still on its first, short life: minted, never yet used for a page.
    const firstLife = session.accessExpiresAt - session.createdAt < ttl;
    if (left < ttl / 2 || firstLife) {
      // F8
      let result;
      try {
        result = await remintOnce({ appName: config.appName, store: tokens, session, settings: demo, cause: 'slide', now });
      } catch {
        result = { status: 'unavailable' } as const;
      }
      if (result.status === 'ok' || result.status === 'already') return result.session;
      // `gone`: the token no longer exists (evicted, expired, revoked) — the
      // visit is over. Paused, unavailable or limited: keep a session that
      // still has time on it; the next page tries again.
      if (result.status !== 'gone' && left > KEEP_WITHOUT_REMINT_MS) return session;
      return visitEnded(session, store, now);
    }

    // F9, and `touch` at most once per interval (Y-B1): the token's last-use
    // score moves, so a visitor reading for twenty minutes is never the idle
    // token a full demo evicts. Best effort: a missed touch costs nothing now.
    if (now - (session.lastTouchAt ?? 0) >= demo.touchIntervalSeconds * 1000) {
      try {
        await tokens.touch({ sessionId: session.id, token: session.accessToken, settings: demo, now });
      } catch {
        // The next request touches it.
      }
    }
    return session;
  }

  async function sessionFor(cookieValue: string | undefined): Promise<Session | null> {
    if (!cookieValue) return null; // F1
    const config = settings();
    const store = await sessionStore(config);
    const session = await store.get(cookieValue);
    if (!session) return null; // F1
    return isDemoSession(session) ? demoSessionFor(session, store) : realSessionFor(session, store);
  }

  /** The answer the proxy gives for a visit that has ended (X3): 401 `demo_session_ended`. */
  function sessionEnded(correlationId: string): Response {
    return new Response(
      JSON.stringify(
        codedProblemBody(401, DEMO_PROBLEM_CODES.sessionEnded, 'Unauthorized', 'your demo session has ended', correlationId, { demo: true }),
      ),
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  /**
   * Sends one request to the API as `session`, and repairs what a demo visit
   * can meet on the way (X1–X5, X8). `send` is called with a token and must
   * be callable twice with the same body, which is why the proxy buffers it.
   *
   *   - X1, X5: anything but a 401, or any session but a demo one, is the answer.
   *   - X2: `401 demo_reset` — the demo was rebuilt underneath the visit. One
   *     single-flight re-mint, then the same request once more with the new
   *     token; X8 re-sets the re-entry cookie.
   *   - X3: `401 demo_session_ended`, or a re-mint that failed — the visit is
   *     over; its parked session comes back if it can.
   *   - X4: whatever the resend answers is the answer, 401 or not: never a
   *     second re-mint in one request.
   *
   * One more case, before X3: an ended-session answer for a token another
   * request has *already* rotated — the record holds a newer token than the
   * one this request carried — is a race, not an ending, and is resent with
   * the record's token instead of ending a live visit.
   */
  async function sendAsSession(
    session: Session,
    send: (token: string) => Promise<Response>,
    correlationId: string,
  ): Promise<{ response: Response; session: Session | null; cookies: string[] }> {
    const first = await send(session.accessToken);
    if (!isDemoSession(session) || first.status !== 401) return { response: first, session, cookies: [] };

    const text = await first.text();
    const code = problemCodeOf(text);
    const config = settings();
    const store = await sessionStore(config);
    const now = Date.now();

    const end = async () => {
      const after = await endDemoVisit({ config, sessions: store, tokens: await demoTokenStore(config), session, now });
      // Restored under the same id, the cookie already names the person's
      // own session again; otherwise it names nothing and is cleared.
      return { response: sessionEnded(correlationId), session: after, cookies: isRealSession(after) ? [] : [clearedSessionCookie()] };
    };

    if (code === DEMO_PROBLEM_CODES.reset && config.demo !== null) {
      let result;
      try {
        result = await remintOnce({
          appName: config.appName,
          store: await demoTokenStore(config),
          session,
          settings: config.demo,
          cause: 'reset',
          now,
        });
      } catch {
        result = { status: 'unavailable' } as const;
      }
      if ((result.status === 'ok' || result.status === 'already') && isDemoSession(result.session)) {
        const retry = await send(result.session.accessToken);
        return { response: retry, session: result.session, cookies: [demoCookie(result.session.persona, now)] };
      }
      return end();
    }

    if (code === DEMO_PROBLEM_CODES.sessionEnded) {
      const stored = await store.get(session.id);
      if (isDemoSession(stored) && stored.accessToken !== session.accessToken) {
        return { response: await send(stored.accessToken), session: stored, cookies: [] };
      }
      return end();
    }

    // Any other 401 is the API's to explain: passed on exactly as it came.
    return {
      response: new Response(text, { status: first.status, statusText: first.statusText, headers: first.headers }),
      session,
      cookies: [],
    };
  }

  /** Revokes the demo session a real sign-in replaces (C9): one browser, one kind of session. */
  async function revokeReplacedDemo(request: Request): Promise<void> {
    const id = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
    if (!id) return;
    const config = settings();
    const store = await sessionStore(config);
    const previous = await store.get(id);
    if (!isDemoSession(previous)) return;
    await (await demoTokenStore(config)).revoke(previous.accessToken);
    await store.delete(previous.id);
  }

  /**
   * O2: the parked session, made sure of before anybody is told "you're back".
   * A provider session is refreshed — Keycloak ends an idle SSO session after
   * thirty minutes, so a parked one that cannot refresh is gone, whatever its
   * record says (Y-m3). A development session has nothing to refresh and is
   * good while its token is.
   */
  async function confirmParked(parked: Session, store: SessionStore): Promise<Session | null> {
    const config = settings();
    if (parked.kind === 'dev') return needsRefresh(parked) ? null : parked;
    if (!config.oidc || !parked.refreshToken) return null;
    try {
      const tokens = await refreshTokens(config.oidc, parked.refreshToken);
      const refreshed: Session = {
        ...parked,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? parked.refreshToken,
        accessExpiresAt: Date.now() + tokens.expiresInSeconds * 1000,
        displayName: readClaims(tokens.accessToken).displayName ?? parked.displayName,
      };
      await store.put(refreshed, config.sessionTtlSeconds);
      await recordSession(config, refreshed.accessToken);
      return refreshed;
    } catch {
      return null;
    }
  }

  const demoHandlers = createDemoHandlers({
    config: settings,
    area,
    env,
    sessionFor,
    redirect,
    here,
    sessionCookie,
    sendAsSession,
  });

  return {
    get config() {
      return settings();
    },

    developmentSignInAvailable: () => developmentSignInAvailable(settings()),

    async login(request) {
      const config = settings();
      const url = new URL(request.url);
      const now = Date.now();

      // L0, in every mode (RV3): a network asking to sign in more than sixty
      // times a minute is filling Redis with pending records, not signing in.
      const limited = await loginLimit(config, request, now, newCorrelationId());
      if (limited) return limited;

      const redirectTo = safeRedirectTarget(url.searchParams.get('redirectTo'), config.defaultLanding);
      const cookieHeader = request.headers.get('cookie');
      const cookies: string[] = [];

      if (url.searchParams.get('account') === '1') {
        // L1: a real sign-in, asked for by name. It always wins (D22), so the
        // demo's re-entry cookie goes now, before the provider round trip.
        cookies.push(clearedDemoCookie());
      } else if (config.demo !== null && area !== null) {
        const persona = demoPersonaForArea(area).key;
        if (url.searchParams.get('demo') === '1') {
          // L2: already in today's demo here. L3: otherwise, `/demo` decides —
          // a same-origin hop, so it reopens the demo by itself (P7). A demo
          // visitor never meets the identity provider.
          const session = await sessionFor(readCookie(cookieHeader, SESSION_COOKIE));
          if (await isCurrentDemo(session)) return redirect(here(redirectTo), 302);
          return redirect(`${demoEntryHref(config.appOrigin, persona, redirectTo)}&resumed=1`, 302);
        }
        // L4: this browser was in the demo today; offer it back rather than
        // send a visitor to a provider they have no account with. Offered,
        // never applied: without `demo=1` the choice is the person's (D22).
        if (readDemoReentry(cookieHeader, area, now)) {
          return redirect(here(`${config.signInPath}?redirectTo=${encodeURIComponent(redirectTo)}`), 302);
        }
      }

      if (!config.oidc) {
        // L5: no provider configured. In development that is the form;
        // anywhere else `readConfig` has already refused to start, so the
        // second branch is unreachable — and says why if it ever is not.
        if (!developmentSignInAvailable(config)) return signInFailed('config', cookies);
        return redirect(here(`${config.signInPath}?redirectTo=${encodeURIComponent(redirectTo)}`), 302, cookies);
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
        cookies,
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
        // never knowingly reused. Only a real session counts: the callback is
        // no part of a demo visit.
        if (isRealSession(await sessionFor(readCookie(cookies, SESSION_COOKIE)))) {
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
        const session = await createSession(
          config,
          { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresInSeconds: tokens.expiresInSeconds },
          { kind: 'oidc' },
        );

        // C9: signed in. A demo session this browser held is revoked — a real
        // sign-in always wins (D22) — and the re-entry cookie goes with it.
        // The retry marker is cleared too, so the next stale callback, however
        // soon, gets its own silent retry.
        await revokeReplacedDemo(request);
        return redirect(here(safeRedirectTarget(pending.redirectTo, config.defaultLanding)), 302, [
          sessionCookie(session.id),
          clearedRetryCookie(),
          clearedDemoCookie(),
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
        // O1. A refused request changes nothing — not even the re-entry
        // cookie — so another site cannot use this route to sign anyone out.
        assertSameOrigin('POST', request.headers, config.appOrigin);
      } catch (error) {
        if (error instanceof ProxyRefused) return problem(403, 'Forbidden', error.message, newCorrelationId());
        throw error;
      }

      const signedOut = (query = ''): string => `${postLogoutUriFor(config.appOrigin, config.signedOutPath)}${query}`;
      const id = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
      const store = await sessionStore(config);
      const record = id ? await store.get(id) : null;

      if (isDemoSession(record)) {
        const tokens = await demoTokenStore(config);
        const parked = await parkedSessionFor(store, record, Date.now());
        // A demo sign-out never calls the provider: the visitor has no session there.
        await tokens.revoke(record.accessToken);
        await store.delete(record.id);
        if (parked) {
          // O2: "End demo" hands back the account this device was signed in
          // to before — but only once its sign-in is known to still work.
          const restored = await confirmParked(parked, store);
          if (restored) {
            return redirect(signedOut('?demo=1&restored=1'), 303, [sessionCookie(restored.id), clearedDemoCookie()]);
          }
          await store.delete(parked.id);
          return redirect(signedOut('?demo=1&reason=parked_expired'), 303, [clearedSessionCookie(), clearedDemoCookie()]);
        }
        // O3
        return redirect(signedOut('?demo=1'), 303, [clearedSessionCookie(), clearedDemoCookie()]);
      }

      // The server-side record goes first, read once for its refresh token
      // and then deleted. If the provider then fails, the person is signed
      // out of this app regardless, which is the order that fails safe.
      if (id) await store.delete(id);

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
      if (record?.kind === 'oidc' && config.oidc && record.refreshToken) {
        await endProviderSession(config.oidc, record.refreshToken);
      }

      // Every sign-out clears the re-entry cookie: on a shared machine, the
      // next person is not offered somebody else's demo.
      return redirect(signedOut(), 303, [clearedSessionCookie(), clearedDemoCookie()]);
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
        const session = await createSession(config, tokens, { kind: 'dev' });
        // The development form is a real sign-in too, and wins the same way C9 does.
        await revokeReplacedDemo(request);
        return redirect(new URL(redirectTo, config.appOrigin).toString(), 303, [sessionCookie(session.id), clearedDemoCookie()]);
      } catch (error) {
        if (error instanceof DevSignInFailed || error instanceof SessionRefused) return back(error.message);
        throw error;
      }
    },

    demoSignIn: demoHandlers.demoSignIn,
    demoStatus: demoHandlers.demoStatus,
    demoReset: demoHandlers.demoReset,
    demoIpCheck: demoHandlers.demoIpCheck,
    demoEntry: demoHandlers.demoEntry,
    signInPage: demoHandlers.signInPage,

    async proxy(request, segments) {
      const config = settings();
      const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();

      try {
        assertMethodAllowed(request.method);
        assertSameOrigin(request.method, request.headers, config.appOrigin);

        // X6: only `/api/v1` — `/api/demo/v1/…` and everything else the API
        // serves stays out of the browser's reach.
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
        // Buffered once, so a request the demo re-mint has to resend (X2)
        // goes out byte for byte the same the second time.
        const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
        const send = (token: string): Promise<Response> =>
          fetch(`${config.apiBaseUrl}${target}${search}`, {
            method: request.method,
            // X7: the allow-list carries no address and no browser string.
            headers: forwardRequestHeaders(request.headers, token, correlationId),
            // GET and HEAD carry no body, and passing one is a runtime error
            // rather than an empty request.
            ...(body !== null ? { body } : {}),
            // A redirect from the API is a fact about the API, not something to
            // follow on the caller's behalf behind its back.
            redirect: 'manual',
            cache: 'no-store',
          } as FetchInit);

        const sent = await sendAsSession(session, send, correlationId);
        const headers = forwardResponseHeaders(sent.response.headers);
        for (const cookie of sent.cookies) headers.append('set-cookie', cookie);
        return new Response(sent.response.body, {
          status: sent.response.status,
          statusText: sent.response.statusText,
          headers,
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

    latestSession: (session) => latestSession(session),

    clientFor(session, correlationId = newCorrelationId()) {
      // The session a re-mint in this request already replaced, if any: a
      // client built from the layout's copy of the session must not send a
      // token the re-mint has deleted.
      let current: Session = latestSession(session);
      // Server components render during a request, and Next's fetch caches
      // by default. A queue that shows yesterday's tickets because the
      // framework was being helpful is worse than a slow queue.
      const plain = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
        fetch(input, { ...init, cache: 'no-store' } as FetchInit);

      return createClient({
        baseUrl: settings().apiBaseUrl,
        token: () => current.accessToken,
        correlationId,
        fetch: async (input, init) => {
          if (!isDemoSession(current)) return plain(input, init);
          // The SDK sends a string body, so the same request can go twice.
          const send = (token: string): Promise<Response> => {
            const headers = new Headers(init?.headers);
            headers.set('authorization', `Bearer ${token}`);
            return plain(input, { ...init, headers });
          };
          const sent = await sendAsSession(current, send, correlationId);
          // X2's new session serves the rest of this client's calls. After
          // X3 the client stays on the visit that ended — even when a parked
          // session came back — so one page never mixes the demo's data with
          // a person's own; the page's session handling takes it from there.
          if (isDemoSession(sent.session)) current = sent.session;
          return sent.response;
        },
      });
    },
  };
}
