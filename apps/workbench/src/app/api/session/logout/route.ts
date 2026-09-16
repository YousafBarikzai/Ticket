import { NextResponse, type NextRequest } from 'next/server';
import { config } from '../../../../bff/config.js';
import { clearedAttributes, SESSION_COOKIE } from '../../../../bff/cookies.js';
import { discover, endSessionUrl } from '../../../../bff/oidc.js';
import { assertSameOrigin, ProxyRefused } from '../../../../bff/proxy.js';
import { sessionStore } from '../../../../bff/store.js';
import { postLogoutUriFor } from '../../../../bff/urls.js';

/**
 * Signing out.
 *
 * `POST` only. A sign-out on `GET` is reachable from an `<img>` tag on any
 * page on the internet, which is a nuisance rather than a breach — but it is a
 * nuisance that is free to prevent, and the same rule stops a prefetcher from
 * ending somebody's session by looking at a link.
 *
 * The server-side record is deleted first. If the provider's end-session
 * redirect then fails, the person is signed out of this app regardless, which
 * is the order that fails safe.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const settings = config();

  try {
    assertSameOrigin('POST', request.headers, settings.appOrigin);
  } catch (error) {
    if (error instanceof ProxyRefused) return NextResponse.json({ title: 'Forbidden', status: 403 }, { status: 403 });
    throw error;
  }

  const id = request.cookies.get(SESSION_COOKIE)?.value;
  if (id) {
    const store = await sessionStore();
    await store.delete(id);
  }

  let destination = postLogoutUriFor(settings.appOrigin);
  if (settings.oidc) {
    try {
      // Ending the provider's session too: without this, "sign out" on a
      // shared machine leaves the next person one redirect away from the
      // previous person's account.
      destination = endSessionUrl(await discover(settings.oidc), null, destination) ?? destination;
    } catch {
      // A provider that cannot be reached must not stop a sign-out.
    }
  }

  const response = NextResponse.redirect(destination, { status: 303 });
  response.cookies.set(SESSION_COOKIE, '', clearedAttributes());
  return response;
}
