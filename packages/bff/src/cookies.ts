/**
 * The cookies this BFF writes — the session, the short-lived marker the
 * sign-in callback uses, the demo's re-entry cookie and the last page for
 * `/resume` — and the rules the `__Host-` prefix imposes.
 *
 * The prefix is not decoration. A browser refuses to store a `__Host-` cookie
 * unless it is `Secure`, has `Path=/` and carries no `Domain` — which is
 * exactly the set of properties that stops a sibling subdomain, or anything
 * that manages to answer on plain HTTP, from writing a session cookie this app
 * would then trust. Getting one attribute wrong does not weaken the cookie; it
 * makes the browser drop it silently, and the symptom is "sign-in does
 * nothing". So the attributes are built in one place and asserted in a test.
 *
 * `SameSite=Lax` rather than `Strict`: the OIDC provider redirects the browser
 * back here as a top-level GET, and `Strict` would withhold the cookie on
 * exactly that navigation. Lax leaves cross-site *writes* uncovered, which is
 * why `assertSameOrigin` in proxy.ts exists.
 *
 * Serialised and parsed here rather than through a framework's helper, so this
 * package works in any handler that speaks `Request` and `Response` — and so
 * the rules are testable without one.
 */
import {
  DEMO_PERSONA_FOR_AREA,
  isDemoArea,
  isDemoPersonaKey,
  secondsUntilNextReset,
  ukDateKey,
  type DemoArea,
  type DemoPersonaKey,
} from '@itsm/contracts/demo';
import { safeRedirectTarget } from './redirects.js';

export const SESSION_COOKIE = '__Host-session';

export interface CookieAttributes {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'Lax';
  readonly path: '/';
  readonly maxAge: number;
}

export function cookieAttributes(maxAgeSeconds: number): CookieAttributes {
  return { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: maxAgeSeconds };
}

/** Clearing is the same cookie with nothing in it and no life left. */
export function clearedAttributes(): CookieAttributes {
  return cookieAttributes(0);
}

export function serialiseCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${attributes.path}`, `Max-Age=${attributes.maxAge}`];
  if (attributes.httpOnly) parts.push('HttpOnly');
  if (attributes.secure) parts.push('Secure');
  parts.push(`SameSite=${attributes.sameSite}`);
  return parts.join('; ');
}

/**
 * Reads one cookie out of a `Cookie` header.
 *
 * Untrusted input: the header is whatever the client sent, including repeated
 * names, stray semicolons and values that are not valid percent-encoding. The
 * first occurrence wins — which is the safe direction, because appending a
 * second `__Host-session` is exactly how an attacker who can write a cookie on
 * a sibling host would try to override the real one (and the `__Host-` prefix
 * is what stops them writing it in the first place).
 */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const raw = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A value that is not valid percent-encoding names no session.
      return undefined;
    }
  }
  return undefined;
}

/**
 * The stale-callback retry marker (Keycloak Step A; SPEC §4.5 rows C5–C7).
 *
 * A sign-in callback whose pending record is gone is usually not an attack:
 * it is the Back button straight after signing in, or a login page left open
 * past its life, and under the provider's single sign-on one fresh round trip
 * finishes it without the person typing anything. The marker is what keeps
 * that recovery to exactly one attempt — a second miss inside the minute is
 * reported as stale rather than bounced through the provider again, so a
 * genuinely broken flow cannot loop. Sixty seconds is long enough for one
 * round trip through the provider and short enough that the next real
 * sign-in starts clean.
 *
 * Same attributes as the session cookie, `SameSite=Lax` included: the
 * provider brings the browser back here with a top-level cross-site GET, and
 * that is the one request the marker has to arrive on.
 */
export const RETRY_COOKIE = '__Host-itsm-retry';
export const RETRY_COOKIE_SECONDS = 60;

/**
 * Why a sign-in did not finish, as the code `/signed-out?reason=` carries.
 *
 * Codes rather than prose (SPEC §4.6.3). The page used to print whatever the
 * query string said, which made `/signed-out?reason=…` a page anyone could
 * put their own sentence on under this app's name. Now the BFF emits one of
 * these codes, the page maps it to a sentence written here, and anything
 * else — an old link, a hand-edited URL — reads as the generic sentence.
 *
 * Kept in this module because `@itsm/bff/cookies` is the package's light
 * entry (its only import outside this package is the zod-free
 * `@itsm/contracts/demo`): the pages that show these sentences import it
 * without pulling in the SDK or the Redis client, as the edge proxies do.
 * `parked_expired` is emitted by the demo sign-out (row O2), not by the
 * provider flow; it is listed so the vocabulary has one home.
 */
export const SIGN_IN_FAILURE_REASONS = [
  'stale',
  'incomplete',
  'provider',
  'refused',
  'no_tenant',
  'config',
  'parked_expired',
] as const;

export type SignInFailureReason = (typeof SIGN_IN_FAILURE_REASONS)[number];

const FAILURE_SENTENCES: Readonly<Record<SignInFailureReason, string>> = {
  stale: 'That sign-in had already been used, or it expired.',
  incomplete: 'That sign-in link was incomplete.',
  provider: 'The identity provider didn’t finish the sign-in.',
  refused: 'The identity provider refused the sign-in.',
  no_tenant: 'Your account isn’t linked to a workspace yet. Ask your administrator.',
  config: 'This deployment has no identity provider set up.',
  parked_expired: 'Your account’s sign-in expired while you explored; sign in again.',
};

/** What the page says for a code it does not know. */
export const GENERIC_SIGN_IN_FAILURE = 'Something went wrong while signing you in.';

export function isSignInFailureReason(value: unknown): value is SignInFailureReason {
  return typeof value === 'string' && (SIGN_IN_FAILURE_REASONS as readonly string[]).includes(value);
}

/**
 * The sentence for a `reason` query value. Never echoes its input: an unknown
 * code — including `constructor` and `__proto__`, which a plain object lookup
 * would have answered — gets the generic sentence.
 */
export function signInFailureSentence(reason: string | null | undefined): string {
  return isSignInFailureReason(reason) ? FAILURE_SENTENCES[reason] : GENERIC_SIGN_IN_FAILURE;
}

/**
 * The rules a `__Host-` cookie has to satisfy, checked rather than assumed.
 * Exported so the test asserts the contract instead of the implementation.
 */
export function violatesHostPrefix(
  name: string,
  attributes: { readonly secure?: unknown; readonly path?: unknown; readonly domain?: unknown },
): string | null {
  if (!name.startsWith('__Host-')) return null;
  if (attributes.secure !== true) return 'a __Host- cookie must be Secure';
  if (attributes.path !== '/') return 'a __Host- cookie must have Path=/';
  if ('domain' in attributes && attributes.domain !== undefined) return 'a __Host- cookie must not set Domain';
  return null;
}

/* ------------------------------------------------------------------ The demo re-entry cookie */

/**
 * The demo re-entry cookie `D` (SPEC §4.5; D22): `<persona>.<ukDateKey>`, set
 * with the demo session (M7) and re-set by a re-mint in the proxy (X8).
 *
 * It answers one question for a browser whose session is gone — "was this
 * browser exploring the demo today?" — so `/sign-in` can offer "Continue the
 * demo as …" (I1, I2) and a login link can send it there (L4) instead of to
 * an identity provider the visitor has no account with. It is never a
 * credential: honoured silently only together with `demo=1` (L2, L3), and
 * otherwise only ever *offered*. A real sign-in always clears it (L1, C9 and
 * every sign-out), so a person who signs in for real is never steered back
 * into the demo.
 *
 * It lives until the next reset at most, and never longer than a day: a
 * visitor who comes back after midnight meets a new generation, so the
 * cookie's date no longer matches and nothing is offered. `HttpOnly`, as the
 * page reads it server-side; the same `__Host-` attributes as the session.
 */
export const DEMO_COOKIE = '__Host-itsm-demo';

/** The cookie's ceiling: a day, `DEMO_SESSION_MAX_SECONDS`' default. */
export const DEMO_COOKIE_MAX_SECONDS = 86_400;

/** `D`'s value for a persona at an instant: `<persona>.<ukDateKey>`. */
export function demoCookieValue(persona: DemoPersonaKey, now: number = Date.now()): string {
  return `${persona}.${ukDateKey(now)}`;
}

/** Seconds `D` may live from `now`: until the next reset, never more than a day. */
export function demoCookieMaxAge(now: number = Date.now()): number {
  return Math.min(secondsUntilNextReset(now), DEMO_COOKIE_MAX_SECONDS);
}

/** The whole `Set-Cookie` header for `D`. */
export function demoCookie(persona: DemoPersonaKey, now: number = Date.now()): string {
  return serialiseCookie(DEMO_COOKIE, demoCookieValue(persona, now), cookieAttributes(demoCookieMaxAge(now)));
}

/** `D` cleared: every real sign-in and every sign-out sends this. */
export function clearedDemoCookie(): string {
  return serialiseCookie(DEMO_COOKIE, '', clearedAttributes());
}

/**
 * The persona `D` names, when it is valid for this app today; otherwise
 * `null`. Valid means: this app's own persona (an `agent` cookie means
 * nothing to the Help Portal, D11) and today's date in London (a cookie from
 * before the last reset names a generation that is gone). The value is read
 * from the `Cookie` header and is client input like any other.
 */
export function readDemoReentry(
  cookieHeader: string | null | undefined,
  app: string,
  now: number = Date.now(),
): DemoPersonaKey | null {
  return demoReentryFromValue(readCookie(cookieHeader, DEMO_COOKIE), app, now);
}

/** As `readDemoReentry`, from the cookie's value (a page's `cookies().get(DEMO_COOKIE)?.value`). */
export function demoReentryFromValue(
  value: string | null | undefined,
  app: string,
  now: number = Date.now(),
): DemoPersonaKey | null {
  if (!isDemoArea(app)) return null;
  if (!value) return null;
  const separator = value.indexOf('.');
  if (separator < 1) return null;
  const persona = value.slice(0, separator);
  const date = value.slice(separator + 1);
  if (!isDemoPersonaKey(persona) || persona !== DEMO_PERSONA_FOR_AREA[app as DemoArea]) return null;
  return date === ukDateKey(now) ? persona : null;
}

/* ------------------------------------------------------------------ The last page, for /resume */

/**
 * The page a person last had open in this app, bound to their session (SPEC
 * §3.3; A2 §4.2).
 *
 * An area row in the switcher goes to the sibling's `/resume`, which answers
 * with this page, so moving from the Service Desk to the Help Portal and back
 * lands where the person left off instead of on the home page. The value is
 * `1.<h16>.<p>`: a version, the first 16 hex characters of SHA-256 of the
 * `__Host-session` value it was written under, and the encoded path.
 *
 * Why bind it to the session. A new session — a real sign-in after a demo, a
 * demo after a real session, another person at a shared desk — never resumes
 * the previous session's page; the hash simply stops matching, with no store
 * lookup on the way. That closes "a real user lands on yesterday's demo
 * ticket" (D22) without the proxy reading anything but cookies. The hash, not
 * the identifier, because the identifier is the session's whole secret and a
 * second cookie is a second place to leak it from.
 *
 * Same `__Host-` attributes as the session cookie; twelve hours, the session's
 * own default life (`BFF_SESSION_TTL_SECONDS`), since a value that outlives
 * its session can never match again. The digest is WebCrypto's, so the edge
 * and Node proxies compute the same thing.
 */
export const LAST_PATH_COOKIE = '__Host-itsm-last';
export const LAST_PATH_COOKIE_SECONDS = 43_200;

/** A cookie is small and sent on every request: a path that does not fit is not remembered. */
export const LAST_PATH_MAX_BYTES = 1_024;

const LAST_PATH_VERSION = '1';

/**
 * Paths that are not a page to come back to: the API and BFF routes, the
 * demo entry and `/resume` itself (which would loop), and the sign-in and
 * offline pages (which would strand a signed-in person on a dead end).
 */
const NOT_A_PAGE = /^\/(?:api|demo|resume|sign-in|signed-out|offline)(?:[/?#]|$)/;

async function sessionHash(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The path without Next's `_rsc` parameter, which is a cache key for the
 * router's own requests and not part of the page; everything else in the
 * query is kept exactly as it was written.
 */
function withoutRscParameter(path: string): string {
  const query = path.indexOf('?');
  if (query < 0) return path;
  const kept = path
    .slice(query + 1)
    .split('&')
    .filter((pair) => pair !== '' && pair.split('=', 1)[0] !== '_rsc');
  return kept.length > 0 ? `${path.slice(0, query)}?${kept.join('&')}` : path.slice(0, query);
}

/** The cookie's value for `path` under `sessionId`. */
export async function lastPathValue(sessionId: string, path: string): Promise<string> {
  return `${LAST_PATH_VERSION}.${await sessionHash(sessionId)}.${encodeURIComponent(withoutRscParameter(path))}`;
}

/**
 * The whole `Set-Cookie` header for `path`, or `null` when it is not worth
 * writing: a path that is not a same-origin page, or one whose stored value
 * would be over `LAST_PATH_MAX_BYTES` (measured as written, after the cookie's
 * own encoding).
 */
export async function lastPathCookie(sessionId: string, path: string): Promise<string | null> {
  const page = withoutRscParameter(path);
  if (NOT_A_PAGE.test(page) || safeRedirectTarget(page, '') !== page) return null;
  const value = await lastPathValue(sessionId, page);
  if (encodeURIComponent(value).length > LAST_PATH_MAX_BYTES) return null;
  return serialiseCookie(LAST_PATH_COOKIE, value, cookieAttributes(LAST_PATH_COOKIE_SECONDS));
}

/** What `shouldRecordLastPath` needs from a request: a `Request`, or Next's `NextRequest`. */
export interface LastPathRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Pick<Headers, 'get'>;
}

function isPrefetch(headers: Pick<Headers, 'get'>): boolean {
  if (headers.get('next-router-prefetch') === '1') return true;
  if (headers.get('next-router-segment-prefetch')) return true;
  if (headers.get('purpose')?.toLowerCase() === 'prefetch') return true;
  return (headers.get('sec-purpose') ?? '').toLowerCase().includes('prefetch');
}

/**
 * A page the person is going to: a full load (`Sec-Fetch-Dest: document`) or
 * a client navigation (`RSC: 1`). A stylesheet, an image or a script the
 * proxy happens to see is not a place to come back to. Without fetch
 * metadata (an old browser, a test client) an HTML `Accept` stands in.
 */
function isNavigation(headers: Pick<Headers, 'get'>): boolean {
  if (headers.get('rsc') === '1') return true;
  const destination = headers.get('sec-fetch-dest');
  if (destination !== null) return destination === 'document';
  return (headers.get('accept') ?? '').includes('text/html');
}

/**
 * Whether a proxy should write the last-path cookie for this request: a GET
 * navigation to a page, never a prefetch (which is a guess, not a visit),
 * never the paths in `NOT_A_PAGE`, and only with a session cookie to bind it
 * to. The path and size rules are `lastPathCookie`'s, which the caller
 * then asks for the header.
 */
export function shouldRecordLastPath(request: LastPathRequest): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  if (!readCookie(request.headers.get('cookie'), SESSION_COOKIE)) return false;
  if (isPrefetch(request.headers) || !isNavigation(request.headers)) return false;
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return false;
  }
  return !NOT_A_PAGE.test(pathname);
}

/**
 * Where `/resume` sends this session: the remembered page when the cookie was
 * written under the same session and still names a same-origin page;
 * otherwise `fallback`, the area's home. Never throws: the cookie is client
 * input like any other.
 */
export async function resumeTarget(cookieValue: string | null | undefined, sessionId: string | null | undefined, fallback: string): Promise<string> {
  if (!cookieValue || !sessionId) return fallback;
  const match = /^([0-9]+)\.([0-9a-f]{16})\.(.+)$/.exec(cookieValue);
  if (!match || match[1] !== LAST_PATH_VERSION) return fallback;
  if (match[2] !== (await sessionHash(sessionId))) return fallback;
  let path: string;
  try {
    path = decodeURIComponent(match[3]!);
  } catch {
    return fallback;
  }
  return NOT_A_PAGE.test(path) ? fallback : safeRedirectTarget(path, fallback);
}
