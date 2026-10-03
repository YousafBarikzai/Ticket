import { appOrigins } from '@itsm/contracts/areas';
import {
  computeDemoStatus,
  DEMO_COPY,
  DEMO_RESET_COOLDOWN_SECONDS,
  demoPersonaForArea,
  demoWindow,
  mayMint,
  type DemoArea,
  type DemoStatusRecords,
} from '@itsm/contracts/demo';
import { developmentSignInAvailable, type BffConfig, type Environment } from '../config.js';
import { demoCookie, demoReentryFromValue, readCookie, SESSION_COOKIE } from '../cookies.js';
import { createSession } from '../create-session.js';
import { assertSameOrigin, codedProblemBody, forwardResponseHeaders, ProxyRefused } from '../proxy.js';
import { safeRedirectTarget } from '../redirects.js';
import { isDemoSession, isRealSession, newCorrelationId, type Session } from '../session.js';
import { sessionStore } from '../store.js';
import { decideDemoEntry, decideSignIn, type DemoEntryDecision, type HeaderSource, type QuerySource, type SignInDecision } from './entry.js';
import { requestIpBucket } from './ip.js';
import { MemoryKeyspace } from './memory-store.js';
import { demoMintLogLine, demoTokenStore } from './store.js';

/**
 * The demo's own BFF routes (SPEC §4.5 rows M1–M7, T1–T6, the IP check and
 * L0; A3 §5.3, §6.3, §6.4, §8.1), and the two page decisions with their
 * inputs gathered (P and I rows).
 *
 * Each app mounts them as one-line route handlers, like the sign-in routes:
 * `POST /api/session/demo`, `GET /api/demo/status`, `POST /api/demo/reset`,
 * `GET /api/demo/ip-check`. They are written against `Request` and
 * `Response`, and the pieces of `createBff` they share — the session reader,
 * the redirect helper, the proxy's re-minting sender — arrive in a context,
 * so this module never imports `bff.ts`.
 *
 * Every route but the IP check answers 404 while `DEMO_MODE` is off here
 * (`BffConfig.demo` is `null`): the routes exist in every build, so a route
 * listing reads the same in every mode, and the switch is the configuration.
 */

/** What `createBff` lends the demo routes. */
export interface DemoHandlerContext {
  readonly config: () => BffConfig;
  /** This app's area, or `null` for a BFF that is not one of the three apps (no demo there). */
  readonly area: DemoArea | null;
  readonly env: Environment;
  readonly sessionFor: (cookieValue: string | undefined) => Promise<Session | null>;
  readonly redirect: (location: string, status?: 302 | 303 | 307, cookies?: readonly string[]) => Response;
  /** Absolute, on this app's origin. */
  readonly here: (path: string) => string;
  readonly sessionCookie: (id: string, maxAgeSeconds?: number) => string;
  /**
   * Sends a request to the API as a session, applying the proxy's re-mint
   * rows (X2–X4, X8); returns the answer and the cookies it needs set.
   */
  readonly sendAsSession: (
    session: Session,
    send: (token: string) => Promise<Response>,
    correlationId: string,
  ) => Promise<{ readonly response: Response; readonly cookies: readonly string[] }>;
}

export interface DemoHandlers {
  demoSignIn(request: Request): Promise<Response>;
  demoStatus(request: Request): Promise<Response>;
  demoReset(request: Request): Promise<Response>;
  demoIpCheck(request: Request): Promise<Response>;
  demoEntry(input: DemoEntryRequest): Promise<DemoEntryDecision>;
  signInPage(input: SignInPageRequest): SignInDecision;
}

/** What a `/demo` page hands over: the session cookie, its search parameters and its request headers. */
export interface DemoEntryRequest {
  readonly cookie: string | undefined;
  readonly query: QuerySource;
  readonly headers: HeaderSource;
}

/** What a `/sign-in` page hands over: the re-entry cookie's value and the query's `redirectTo`. */
export interface SignInPageRequest {
  readonly demoCookie: string | undefined;
  readonly redirectTo: string | null | undefined;
}

/** T2's in-process cache: one read of Redis per replica per five seconds, however many tabs poll. */
export const DEMO_STATUS_CACHE_MS = 5_000;

type FetchInit = RequestInit & { cache?: 'no-store' | 'force-cache' };

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function notFound(correlationId: string): Response {
  return json(codedProblemBody(404, 'not_found', 'Not Found', 'there is no demo here', correlationId), 404);
}

function forbidden(detail: string, correlationId: string): Response {
  return json(codedProblemBody(403, 'forbidden', 'Forbidden', detail, correlationId), 403);
}

/**
 * The cooldown the status counts down. The worker and the API own the real
 * one; a deployment that tunes `DEMO_RESET_COOLDOWN_SECONDS` sets it on the
 * apps too, so the bar and the API agree on when the next reset may start.
 * A value that is not a whole number of seconds is ignored, not trusted.
 */
function cooldownSeconds(env: Environment): number {
  const raw = env.DEMO_RESET_COOLDOWN_SECONDS?.trim();
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : DEMO_RESET_COOLDOWN_SECONDS;
}

const NO_RECORDS: DemoStatusRecords = Object.freeze({ live: null, build: null, cooldown: null, paused: false, backoff: null });

export function createDemoHandlers(ctx: DemoHandlerContext): DemoHandlers {
  let statusCache: { readonly at: number; readonly records: DemoStatusRecords } | null = null;

  /** The settings when the demo is on here, else `null`. */
  const demoOn = () => {
    const config = ctx.config();
    return config.demo !== null && ctx.area !== null ? { config, settings: config.demo, area: ctx.area } : null;
  };

  return {
    /**
     * `POST /api/session/demo` (M1–M7). Never a 200: a problem (M1, M2) or a
     * 303 back to `/demo` with a reason (M3, M5, M6) or on to the visit (M4, M7).
     */
    async demoSignIn(request) {
      const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();
      const on = demoOn();
      if (!on) return notFound(correlationId); // M1
      const { config, settings, area } = on;

      try {
        assertSameOrigin('POST', request.headers, config.appOrigin); // M2
      } catch (error) {
        if (error instanceof ProxyRefused) return forbidden(error.message, correlationId);
        throw error;
      }

      let form: FormData | null;
      try {
        form = await request.formData();
      } catch {
        form = null;
      }
      const persona = form?.get('persona');
      const rawRedirect = form?.get('redirectTo');
      const redirectTo = safeRedirectTarget(typeof rawRedirect === 'string' ? rawRedirect : null, config.defaultLanding);
      // M3: a form that cannot be read, or a persona this app does not mint.
      if (!form || !mayMint(area, persona)) return ctx.redirect(ctx.here('/demo?demo=1&reason=invalid'), 303);

      const back = (reason: string): Response =>
        ctx.redirect(ctx.here(`/demo?demo=1&redirectTo=${encodeURIComponent(redirectTo)}&reason=${reason}`), 303);

      const now = Date.now();
      const tokens = await demoTokenStore(config);
      const current = await ctx.sessionFor(readCookie(request.headers.get('cookie'), SESSION_COOKIE));

      // M4: already in today's demo here — no second token.
      if (isDemoSession(current) && current.persona === persona) {
        const { live } = await tokens.readStatusRecords();
        if (live !== null && current.demoGeneration === live.generation) return ctx.redirect(ctx.here(redirectTo), 303);
      }

      // M5: a person signed in to their own account is asked, never switched.
      const confirmed = form.get('confirm') === 'replace';
      if (isRealSession(current) && !confirmed) return back('confirm');

      let minted;
      try {
        const ipb = await requestIpBucket(request.headers, { mode: config.clientIpHeader, salts: tokens, kind: 'mint', now });
        minted = await tokens.mint({ app: area, persona, ipb, settings, now });
      } catch (error) {
        // A store that cannot be reached is an outage, not a refusal: the
        // visitor is told it is busy and may try again, and the log says why.
        console.warn(`[bff:${config.appName}] demo mint failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        return back('busy');
      }
      console.info(demoMintLogLine(config.appName, minted));
      // M6: `unavailable` (no live generation) reads as "being prepared".
      if (!minted.ok) return back(minted.reason === 'unavailable' ? 'preparing' : minted.reason);

      // M7. The real session it confirmed away is parked, to come back when
      // the demo ends; a stale demo session it replaces hands its own parked
      // session on (Y-m3) and is revoked, so one browser holds one token.
      const parkedSessionId = isRealSession(current) ? current.id : isDemoSession(current) ? current.parkedSessionId : undefined;
      if (isDemoSession(current)) {
        await tokens.revoke(current.accessToken);
        await (await sessionStore(config)).delete(current.id);
      }
      const session = await createSession(
        config,
        {
          accessToken: minted.token,
          expiresInSeconds: Math.max(0, Math.ceil((minted.record.exp - now) / 1000)),
          tenantId: minted.record.tenantId,
          userId: minted.record.userId,
          displayName: demoPersonaForArea(area).name,
        },
        {
          kind: 'demo',
          persona,
          demoGeneration: minted.record.gen,
          demoSid: minted.record.sid,
          accessExpiresAt: minted.record.exp,
          now,
          ...(parkedSessionId ? { parkedSessionId } : {}),
        },
      );
      // Two `Set-Cookie` headers, never one folded with a comma (Y-m1): the
      // session for a day at most, and the re-entry cookie until the reset.
      return ctx.redirect(ctx.here(redirectTo), 303, [
        ctx.sessionCookie(session.id, settings.sessionMaxSeconds),
        demoCookie(persona, now),
      ]);
    },

    /**
     * `GET /api/demo/status` (T1, T2): the API's public status, computed
     * here from one `MGET`, so the bar never waits on the API. Never cached
     * by a browser or a CDN; cached here for five seconds per replica.
     */
    async demoStatus(request) {
      const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();
      const on = demoOn();
      if (!on) return notFound(correlationId); // T1
      const now = Date.now();
      if (!statusCache || now - statusCache.at >= DEMO_STATUS_CACHE_MS) {
        try {
          statusCache = { at: now, records: await (await demoTokenStore(on.config)).readStatusRecords() };
        } catch {
          return json(
            codedProblemBody(503, 'demo_unavailable', 'Service Unavailable', DEMO_COPY.unavailable, correlationId, {
              demo: true,
              reason: 'store',
            }),
            503,
          );
        }
      }
      // Recomputed on every call from the cached records, so `serverNow`
      // and the countdown are never five seconds stale.
      return json(computeDemoStatus(statusCache.records, now, { cooldownSeconds: cooldownSeconds(ctx.env) }), 200); // T2
    },

    /**
     * `POST /api/demo/reset` (T3–T6): a visitor's reset, forwarded to the API
     * with the session's token. The API applies the cooldown, the lock and the
     * backoff (§4.6.4); the answer — 202, 409, 429 with `Retry-After` — comes
     * back as it was. A visit one generation behind meets `401 demo_reset`
     * first, which the re-mint repairs before the resend (X2).
     */
    async demoReset(request) {
      const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();
      const on = demoOn();
      if (!on) return notFound(correlationId); // T3
      try {
        assertSameOrigin('POST', request.headers, on.config.appOrigin); // T4
      } catch (error) {
        if (error instanceof ProxyRefused) return forbidden(error.message, correlationId);
        throw error;
      }
      const session = await ctx.sessionFor(readCookie(request.headers.get('cookie'), SESSION_COOKIE));
      if (!isDemoSession(session)) return forbidden(DEMO_COPY.resetOnlyInDemo, correlationId); // T5

      const body = await request.arrayBuffer();
      const send = (token: string): Promise<Response> =>
        fetch(`${on.config.apiBaseUrl}/api/demo/v1/reset`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': request.headers.get('content-type') ?? 'application/json',
            accept: 'application/json',
            'x-correlation-id': correlationId,
          },
          body,
          redirect: 'manual',
          cache: 'no-store',
        } as FetchInit);

      let sent;
      try {
        sent = await ctx.sendAsSession(session, send, correlationId); // T6
      } catch {
        return json(codedProblemBody(502, 'bad_gateway', 'Bad Gateway', 'the API could not be reached', correlationId), 502);
      }
      const headers = forwardResponseHeaders(sent.response.headers);
      for (const cookie of sent.cookies) headers.append('set-cookie', cookie);
      return new Response(sent.response.body, { status: sent.response.status, statusText: sent.response.statusText, headers });
    },

    /**
     * `GET /api/demo/ip-check` (§4.8): the caller's own bucket and nothing
     * else, so the post-deploy check can tell whether the edge passes a
     * forged `X-Forwarded-For` through. Answers in every mode, because the
     * sign-in limiter buckets callers in every mode (RV3).
     */
    async demoIpCheck(request) {
      const config = ctx.config();
      const tokens = await demoTokenStore(config);
      const bucket = await requestIpBucket(request.headers, { mode: config.clientIpHeader, salts: tokens, kind: 'mint' });
      return json({ bucket }, 200);
    },

    /** The P-row decision for this request, with the session and the demo's records read here. */
    async demoEntry(input) {
      const on = demoOn();
      if (!on) return { row: 'P1', kind: 'not-found' };
      const session = await ctx.sessionFor(input.cookie);
      let records: DemoStatusRecords;
      try {
        records = await (await demoTokenStore(on.config)).readStatusRecords();
      } catch {
        // Nothing can be read: the page says the demo is being prepared and
        // checks again by itself, which is true from the visitor's side.
        records = NO_RECORDS;
      }
      return decideDemoEntry({
        app: on.area,
        mode: true,
        paused: records.paused,
        liveGeneration: records.live?.generation ?? null,
        buildEtaSec: records.build?.etaSec ?? null,
        session,
        query: input.query,
        headers: input.headers,
        origins: appOrigins(ctx.env),
        ownOrigin: on.config.appOrigin,
        defaultLanding: on.config.defaultLanding,
      });
    },

    /** The I-row decision for `/sign-in`. */
    signInPage(input) {
      const config = ctx.config();
      const reentry = ctx.area !== null ? demoReentryFromValue(input.demoCookie, ctx.area) : null;
      return decideSignIn({
        app: ctx.area ?? config.appName,
        mode: config.demo !== null && ctx.area !== null,
        development: developmentSignInAvailable(config),
        reentry,
        redirectTo: input.redirectTo,
        defaultLanding: config.defaultLanding,
        ownOrigin: config.appOrigin,
        siteOrigin: appOrigins(ctx.env).site ?? null,
      });
    },
  };
}

/* ------------------------------------------------------------------ L0: the sign-in limiter */

/**
 * `GET /api/session/login` per IP bucket per minute, in every mode (SPEC §4.5
 * L0, RV3, Y-m17).
 *
 * Keycloak Step A keeps a pending sign-in for 1,800 s, so every login request
 * leaves a record in Redis for half an hour whether or not the demo is on;
 * sixty a minute per network is far above what people do and far below what
 * fills a Redis. The key is a BFF key, not a demo one —
 * `bff:<app>:rl:login:<ipb>:m:<m>` — because it exists in every mode; the
 * bucket is the demo's salted one (§4.8), because that is the one place an
 * address is turned into something storable.
 */
export const LOGIN_LIMIT_PER_MINUTE = 60;

/** One minute's window, kept two minutes so the counter outlives its own minute (`EX 120`). */
const LOGIN_WINDOW_TTL_MS = 120_000;

export function loginRateKey(appName: string, ipb: string, now: number): string {
  return `bff:${appName}:rl:login:${ipb}:${demoWindow('m', now)}`;
}

/** Counts a hit in a window and answers the count; the window's expiry is set by the first hit. */
export interface LoginCounter {
  hit(key: string, windowTtlMs: number): Promise<number>;
}

/** The counter as one atomic step: a window that lost its expiry would refuse its bucket for ever. */
const LOGIN_HIT_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

const counters = new Map<string, LoginCounter>();

async function loginCounter(config: Pick<BffConfig, 'appName' | 'redisUrl'>): Promise<LoginCounter> {
  const existing = counters.get(config.appName);
  if (existing) return existing;
  const { redisConnection } = await import('../redis-store.js');
  const redis = redisConnection(config.redisUrl);
  const created: LoginCounter = {
    async hit(key, windowTtlMs) {
      return Number(await redis.eval(LOGIN_HIT_LUA, 1, key, windowTtlMs));
    },
  };
  counters.set(config.appName, created);
  return created;
}

/** Test seam, as `setSessionStore`. Passing `null` forgets the counter. */
export function setLoginCounter(appName: string, counter: LoginCounter | null): void {
  if (counter) counters.set(appName, counter);
  else counters.delete(appName);
}

/** What the memory counter needs of a keyspace; the demo store's `MemoryKeyspace` is one. */
export interface CounterKeyspace {
  incr(key: string): number;
  pttl(key: string): number;
  pexpire(key: string, ms: number): void;
}

/**
 * The counter in memory, for tests. Pass a demo store's `keyspace` to count
 * in the same keyspace the store writes to, as Redis would.
 */
export function memoryLoginCounter(keyspace: CounterKeyspace = new MemoryKeyspace(() => Date.now())): LoginCounter {
  return {
    async hit(key, windowTtlMs) {
      const count = keyspace.incr(key);
      if (count === 1 || keyspace.pttl(key) < 0) keyspace.pexpire(key, windowTtlMs);
      return count;
    },
  };
}

/**
 * L0: a 429 when this bucket has asked to sign in more than sixty times this
 * minute, else `null`.
 *
 * Fails open, unlike the demo's own limits. The limiter protects the pending
 * sign-in records in Redis; when Redis cannot be reached there are none to
 * protect, the provider sign-in fails at L6 on its own, and refusing every
 * sign-in — including the development form, which needs no Redis — would
 * turn an outage of one store into an outage of every way in.
 */
export async function loginLimit(
  config: BffConfig,
  request: Request,
  now: number,
  correlationId: string,
): Promise<Response | null> {
  let count: number;
  try {
    const tokens = await demoTokenStore(config);
    const ipb = await requestIpBucket(request.headers, { mode: config.clientIpHeader, salts: tokens, kind: 'login', now });
    count = await (await loginCounter(config)).hit(loginRateKey(config.appName, ipb, now), LOGIN_WINDOW_TTL_MS);
  } catch (error) {
    console.warn(`[bff:${config.appName}] the sign-in limiter could not count: ${error instanceof Error ? error.message : 'unknown error'}`);
    return null;
  }
  if (count <= LOGIN_LIMIT_PER_MINUTE) return null;
  const retryAfterSec = Math.max(1, 60 - Math.floor((now % 60_000) / 1000));
  return json(
    codedProblemBody(
      429,
      'rate_limited',
      'Too Many Requests',
      `Too many sign-in attempts from this network. Try again in ${retryAfterSec} s.`,
      correlationId,
      { retryAfterSec },
    ),
    429,
    { 'retry-after': String(retryAfterSec) },
  );
}
