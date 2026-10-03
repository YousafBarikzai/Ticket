import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, lastPathCookie, shouldRecordLastPath } from '@itsm/bff/cookies';
import { LAST_VIEW_COOKIE, lastViewValue, viewRefFromPath } from './inbox/views.js';

/**
 * The first thing every page request meets (Next 16 Proxy, Node runtime;
 * SPEC §5.1, F5; v3 §3.3).
 *
 * Four jobs, none of them a security decision — the API refuses a request
 * without a valid session whatever happens here, and `requireSession()` checks
 * the session itself, not just the cookie:
 *
 *   1. **No session cookie → sign in, keeping the deep link.** A link to
 *      `/tickets/INC-000123` pasted into a chat used to land on the inbox after
 *      sign-in; now it lands on the ticket. 307, so the method survives.
 *   2. **Forward the path.** A cookie that exists but whose session has
 *      expired is caught later, in a layout, which cannot see the URL; the
 *      path rides in `x-itsm-path` so that redirect keeps the deep link too.
 *   3. **Remember the view.** Visiting `/inbox/<view>` sets the last-view
 *      cookie that `/inbox` opens on (SPEC D2), because a server component
 *      cannot set a cookie and a client effect would be one render late.
 *   4. **Remember the page** (`__Host-itsm-last`, v3 §3.3): the last page
 *      opened in the Service Desk, bound to this session, so a hop back from
 *      another area through `/resume` lands where the person left off. Every
 *      page, not only views — a ticket is the page most worth returning to.
 *      Prefetches, the auth and demo pages and `/resume` itself are not
 *      places to come back to, and are never written.
 *
 * It imports only the cookies' helpers and the view registry: nothing here
 * may reach the session store, which is a network hop this file must not add
 * to every request. The hash that binds the remembered page to the session
 * is WebCrypto's, computed here without a store.
 */

/** The header that carries the requested path to server components. */
export const PATH_HEADER = 'x-itsm-path';

/** A year: the remembered view is a convenience that should outlive a holiday. */
const LAST_VIEW_MAX_AGE = 60 * 60 * 24 * 365;

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

  const view = viewRefFromPath(request.nextUrl.pathname);
  if (view) {
    response.cookies.set(LAST_VIEW_COOKIE, lastViewValue(view), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: LAST_VIEW_MAX_AGE,
    });
  }

  // Appended after the view cookie: `response.cookies.set` rewrites the
  // `set-cookie` headers from its own list, which knows nothing of this one.
  if (shouldRecordLastPath(request)) {
    const lastPath = await lastPathCookie(sessionId, path);
    if (lastPath) response.headers.append('set-cookie', lastPath);
  }
  return response;
}

/**
 * Everything except the routes that must work without a session: the API
 * and BFF routes (which answer 401 themselves), Next's assets, the
 * stylesheet (so it loads on `/sign-in`), the offline, auth and demo entry
 * pages (`/demo`, but not `/demographics`), the service worker, the manifest,
 * `robots.txt` and the icons (Y-1.3.4). `/resume` stays inside, so a person
 * with no session signs in first and comes back to it.
 */
export const config = {
  matcher: [
    '/((?!api/|_next/|itsm-ui\\.css|offline|sign-in|signed-out|demo(?:/|$)|sw\\.js|manifest\\.webmanifest|robots\\.txt|icon\\.svg|icon-maskable\\.svg|favicon).*)',
  ],
};
