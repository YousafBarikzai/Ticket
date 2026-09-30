import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, safeRedirectTarget, type Session } from '@itsm/bff';
import { ApiError, workbench, type Me, type TeamListRow, type Workbench } from '@itsm/sdk';
import { bff } from '../bff.js';
import { PATH_HEADER } from '../proxy.js';

/**
 * How a server component gets at the API.
 *
 * Server components call the API *directly* rather than through this app's
 * own proxy: the proxy exists so that the browser never holds a token, and a
 * server component already holds the session. Going through the proxy would
 * mean the app making an HTTP request to itself on every render, which is a
 * hop, a timeout and a confusing trace for no gain.
 *
 * Each read is wrapped in `cache()`, so a layout and the page under it share
 * one session lookup and one `/me` per request (F6) — the old frame fetched
 * `/me` in the layout, again in the page and a third time for the live
 * stream's topics.
 *
 * `server-only` is imported for its side effect: it is a module that fails to
 * build if it is ever pulled into a client bundle, which is the difference
 * between a rule about where tokens may live and a rule that is enforced.
 */

export const currentSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  return bff.sessionFor(jar.get(SESSION_COOKIE)?.value);
});

/**
 * Where "sign in again" goes: the login route, told to come back to the page
 * the person was on (F5). The path is the one the proxy saw, so an expired
 * session caught in a layout still lands on the deep link, not on `/inbox`.
 */
export async function loginHref(): Promise<string> {
  const path = safeRedirectTarget((await headers()).get(PATH_HEADER), bff.config.defaultLanding);
  return `/api/session/login?redirectTo=${encodeURIComponent(path)}`;
}

/**
 * Redirects rather than throwing. A page that threw would render a 500, and
 * "your session expired" is not a server error — it is the most ordinary
 * thing that happens to a screen somebody left open overnight.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect(await loginHref());
  return session;
}

/** The SDK, bound to this request's session. */
export function apiFor(session: Session): Workbench {
  return workbench(bff.clientFor(session));
}

/**
 * The signed-in person, once per request. A 401 here is a session the API no
 * longer honours (revoked, or the token outlived its refresh): sign in again,
 * keeping the page. Any other failure is thrown for the caller to decide —
 * the frame shows a suspended workspace its own way, and anything else is an
 * error page.
 */
export const currentMe = cache(async (): Promise<Me> => {
  const session = await requireSession();
  try {
    return await apiFor(session).me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(await loginHref());
    throw error;
  }
});

/** The permission keys the person holds, whatever their scope. */
export function heldPermissions(me: Me): ReadonlySet<string> {
  return new Set(me.permissions.map((permission) => permission.key));
}

/**
 * The tenant's teams (A6), once per request, or `null` when this API cannot
 * say — an older API without the route, or an account that may not read
 * them. The frame then hides team views rather than naming teams by id.
 */
export const currentTeams = cache(async (): Promise<readonly TeamListRow[] | null> => {
  const session = await requireSession();
  try {
    return await apiFor(session).teams();
  } catch {
    return null;
  }
});
