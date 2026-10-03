import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, lastPathCookie, shouldRecordLastPath } from '@itsm/bff/cookies';

/**
 * The console's front door (Next 16 Proxy; SPEC §5.1, F5; v3 §3.3).
 *
 * Three jobs, all about not losing where somebody was going.
 *
 * With no session cookie at all there is nothing to render, so the request is
 * sent straight to sign in — carrying the path and query it asked for, so a
 * link to `/rules?open=rule:vip-requester` from a chat message lands on that
 * rule after signing in rather than on the Command centre.
 *
 * With a cookie, the request goes through with the path in a header
 * (`x-itsm-path`). The cookie can still name a session that has expired, and
 * only the server layout finds that out; the header is how its redirect to sign
 * in knows where to come back to. The header is always overwritten here, so a
 * value a client sent itself never reaches the layout — and the layout only
 * ever uses it as a same-origin path (`safeRedirectTarget`).
 *
 * And a page someone navigates to is remembered in `__Host-itsm-last`, bound
 * to this session by a hash of its cookie, so coming back from another area
 * (`/resume`) lands on it rather than on the Command centre (§3.3). Never for
 * a prefetch, a non-page request or the routes that are not a place to come
 * back to (`shouldRecordLastPath`); the hash is computed with WebCrypto, which
 * is why this function is asynchronous.
 *
 * It imports cookie helpers and nothing else: the session store, Redis and
 * the SDK stay out of the proxy, which runs on every request.
 */

/** The header that carries the requested path to server components. */
export const PATH_HEADER = 'x-itsm-path';

/**
 * The path and query a person asked for, as a sign-in should return them to
 * it. Next's router adds `_rsc` to its own requests; that is a cache key, not
 * part of the page, and must not end up in a bookmark. The rest of the query
 * is kept exactly as it was written (`open=rule:vip` stays readable).
 */
export function requestedPath(url: URL): string {
  const query = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && part !== '_rsc' && !part.startsWith('_rsc='))
    .join('&');
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = requestedPath(request.nextUrl);
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  if (!session) {
    const target = new URL('/api/session/login', request.url);
    target.searchParams.set('redirectTo', path);
    return NextResponse.redirect(target, 307);
  }

  const forwarded = new Headers(request.headers);
  forwarded.set(PATH_HEADER, path);
  const response = NextResponse.next({ request: { headers: forwarded } });
  if (shouldRecordLastPath(request)) {
    const cookie = await lastPathCookie(session, path);
    if (cookie) response.headers.append('set-cookie', cookie);
  }
  return response;
}

/**
 * Everything but the API (it answers 401 for itself), Next's own files, the
 * stylesheet, `robots.txt` and the pages that exist to be seen signed out or
 * to open the demo. A stylesheet behind sign-in would leave `/sign-in`
 * unstyled; `/demo` decides for itself whether to open a session (§4.6.1), and
 * `demo(?:/|$)` matches only that route, so a page such as `/demographics`
 * keeps the front door. `/resume` stays inside: a person without a session
 * signs in with `redirectTo=/resume` and is sent on afterwards.
 */
export const config = {
  matcher: [
    '/((?!api/|_next/|itsm-ui\\.css|offline|sign-in|signed-out|demo(?:/|$)|robots\\.txt|sw\\.js|manifest\\.webmanifest|icon\\.svg|favicon).*)',
  ],
};
