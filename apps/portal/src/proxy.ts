import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, lastPathCookie, shouldRecordLastPath } from '@itsm/bff/cookies';

/**
 * The first thing every page request meets (Next 16 Proxy, Node runtime;
 * SPEC §5.1, F5; v3 §3.3).
 *
 * Three jobs, none of them a security decision — the API refuses a request
 * without a valid session whatever happens here, and `requireSession()` checks
 * the session itself, not just the cookie:
 *
 *   1. **No session cookie → sign in, keeping the deep link.** A link to
 *      `/tickets/INC-000123` in a notification e-mail used to land on Home
 *      after sign-in; now it lands on the request. 307, so the method
 *      survives.
 *   2. **Forward the path.** A cookie that exists but whose session has
 *      expired is caught later, in a layout, which cannot see the URL; the
 *      path rides in `x-itsm-path` so that redirect keeps the deep link too.
 *   3. **Remember the page** (`__Host-itsm-last`, v3 §3.3) on a navigation,
 *      bound to this session by a hash of its cookie, so a switch back from
 *      the Service Desk or Administration (`/resume`) lands on the request the
 *      person was reading. Never for a prefetch, an API call or the sign-in,
 *      demo and offline pages, and never a value over 1 kB.
 *
 * It imports only the cookie helpers' light module: nothing here may reach
 * the session store, which is a network hop this file must not add to every
 * request. The hash is WebCrypto, which is why this is `async`.
 */

/** The header that carries the requested path to server components. */
export const PATH_HEADER = 'x-itsm-path';

/**
 * The path and query a person asked for, as a sign-in should return them to
 * it. Next's router adds `_rsc` to its own requests; that is a cache key, not
 * part of the page, and must not end up in a bookmark.
 */
export function requestedPath(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('_rsc');
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = requestedPath(request.nextUrl);
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    const login = request.nextUrl.clone();
    login.pathname = '/api/session/login';
    login.search = `?redirectTo=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login, 307);
  }

  const forwarded = new Headers(request.headers);
  forwarded.set(PATH_HEADER, path);
  const response = NextResponse.next({ request: { headers: forwarded } });
  if (shouldRecordLastPath(request)) {
    const cookie = await lastPathCookie(sessionId, path);
    if (cookie) response.headers.append('set-cookie', cookie);
  }
  return response;
}

/**
 * Everything except the routes that must work without a session: the API
 * and BFF routes (which answer 401 themselves), Next's assets, the
 * stylesheet (so it loads on `/sign-in`), the offline, auth and demo-entry
 * pages (`demo` only as a whole segment: `/demographics` would be a page
 * like any other), the service worker, the manifest, `robots.txt` and the
 * icons (Y-1.3.4, A3 §6.5). `/resume` stays inside, so a person with no
 * session signs in and comes back to it.
 */
export const config = {
  matcher: [
    '/((?!api/|_next/|itsm-ui\\.css|offline|sign-in|signed-out|demo(?:/|$)|sw\\.js|manifest\\.webmanifest|robots\\.txt|icon\\.svg|icon-maskable\\.svg|favicon).*)',
  ],
};
