import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE, type Session } from '@itsm/bff';
import { admin, type Admin, type Me } from '@itsm/sdk';
import { bff } from '../bff.js';
import { holds } from '../permissions.js';

/**
 * How a server component gets at the API.
 *
 * Server components call the API *directly* rather than through this app's own
 * proxy: the proxy exists so the browser never holds a token, and a server
 * component already holds the session. Going through the proxy would be the
 * app making an HTTP request to itself on every render.
 *
 * `server-only` is imported for its side effect: it is a module that fails to
 * build if it is ever pulled into a client bundle, which is the difference
 * between a rule about where tokens may live and a rule that is enforced.
 */

export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return bff.sessionFor(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Redirects rather than throwing. A page that threw would render a 500, and
 * "your session expired" is not a server error.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/api/session/login');
  return session;
}

/** The SDK, bound to this request's session. */
export function apiFor(session: Session): Admin {
  return admin(bff.clientFor(session));
}

/**
 * The signed-in person, and what they may do.
 *
 * Read once per page rather than per component: every screen in this console
 * shows or hides something on a permission, and a permission check that costs
 * a request is a permission check somebody removes to make the page fast.
 */
export async function currentActor(): Promise<{ session: Session; me: Me; api: Admin }> {
  const session = await requireSession();
  const api = apiFor(session);
  return { session, me: await api.me(), api };
}

/**
 * The gate on the platform section.
 *
 * `notFound`, not a 403. A console that answers "you may not see this" tells
 * somebody there is a platform section and that they are close to it; a 404
 * tells them nothing they did not already know. It is called from the section's
 * *layout*, so it runs before any page in it renders — a per-page check is one
 * page away from being forgotten, and the page somebody forgets is the one that
 * lists every tenant on the deployment.
 */
export async function requirePlatformOperator(): Promise<{ session: Session; me: Me; api: Admin }> {
  const actor = await currentActor();
  if (!holds(actor.me, 'platform.tenant.manage')) notFound();
  return actor;
}
