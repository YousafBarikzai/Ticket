/**
 * The session cookie, and the rules the `__Host-` prefix imposes.
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
 */

export const SESSION_COOKIE = '__Host-session';

export interface CookieAttributes {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge: number;
}

export function cookieAttributes(maxAgeSeconds: number): CookieAttributes {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds };
}

/** Clearing is the same cookie with nothing in it and no life left. */
export function clearedAttributes(): CookieAttributes {
  return cookieAttributes(0);
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
