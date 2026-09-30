import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@itsm/bff/cookies';

/**
 * The console's front door (Next 16 Proxy; SPEC §5.1, F5).
 *
 * Two jobs, both about not losing where somebody was going.
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
 * It imports the cookie's *name* and nothing else: the session store, Redis
 * and the SDK stay out of the proxy, which runs on every request.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  if (!request.cookies.has(SESSION_COOKIE)) {
    const target = new URL('/api/session/login', request.url);
    target.searchParams.set('redirectTo', path);
    return NextResponse.redirect(target, 307);
  }

  const forwarded = new Headers(request.headers);
  forwarded.set('x-itsm-path', path);
  return NextResponse.next({ request: { headers: forwarded } });
}

/**
 * Everything but the API (it answers 401 for itself), Next's own files, the
 * stylesheet and the pages that exist to be seen signed out. A stylesheet
 * behind sign-in would leave `/sign-in` unstyled.
 */
export const config = {
  matcher: ['/((?!api/|_next/|itsm-ui\\.css|offline|sign-in|signed-out|sw\\.js|manifest\\.webmanifest|icon\\.svg|favicon).*)'],
};
