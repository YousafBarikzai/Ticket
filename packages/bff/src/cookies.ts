/**
 * The cookies this BFF writes — the session, and the short-lived marker the
 * sign-in callback uses — and the rules the `__Host-` prefix imposes.
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
 * Kept in this module because `@itsm/bff/cookies` is the package's light,
 * dependency-free entry: the pages that show these sentences import it
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
