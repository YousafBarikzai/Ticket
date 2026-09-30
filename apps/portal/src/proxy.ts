import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@itsm/bff/cookies';

/**
 * The first thing every page request meets (Next 16 Proxy, Node runtime;
 * SPEC §5.1, F5).
 *
 * Two jobs, neither of them a security decision — the API refuses a request
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
 *
 * It imports only the cookie's name: nothing here may reach the session
 * store, which is a network hop this file must not add to every request.
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

export function proxy(request: NextRequest): NextResponse {
  const path = requestedPath(request.nextUrl);

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const login = request.nextUrl.clone();
    login.pathname = '/api/session/login';
    login.search = `?redirectTo=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login, 307);
  }

  const forwarded = new Headers(request.headers);
  forwarded.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers: forwarded } });
}

/**
 * Everything except the routes that must work without a session: the API
 * and BFF routes (which answer 401 themselves), Next's assets, the
 * stylesheet (so it loads on `/sign-in`), the offline and auth pages, the
 * service worker, the manifest and the icons (Y-1.3.4).
 */
export const config = {
  matcher: [
    '/((?!api/|_next/|itsm-ui\\.css|offline|sign-in|signed-out|sw\\.js|manifest\\.webmanifest|icon\\.svg|icon-maskable\\.svg|favicon).*)',
  ],
};
