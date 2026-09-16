import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, type Session } from '@itsm/bff';
import { workbench, type Workbench } from '@itsm/sdk';
import { bff } from '../bff.js';

/**
 * How a server component gets at the API.
 *
 * Server components call the API *directly* rather than through this app's own
 * proxy: the proxy exists so that the browser never holds a token, and a
 * server component already holds the session. Going through the proxy would
 * mean the app making an HTTP request to itself on every render, which is a
 * hop, a timeout and a confusing trace for no gain.
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
 * "your session expired" is not a server error — it is the most ordinary thing
 * that happens to a screen somebody left open overnight.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/api/session/login');
  return session;
}

/** The SDK, bound to this request's session. */
export function apiFor(session: Session): Workbench {
  return workbench(bff.clientFor(session));
}
