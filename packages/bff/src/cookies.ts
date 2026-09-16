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
