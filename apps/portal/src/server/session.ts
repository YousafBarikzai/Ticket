import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, type Session } from '@itsm/bff';
import { portal, type Portal } from '@itsm/sdk';
import { bff } from '../bff.js';

/**
 * How a server component gets at the API.
 *
 * Server components call the API directly with the session's token; the proxy
 * exists so the *browser* never holds one. Going through it here would mean
 * the app making an HTTP request to itself on every render.
 *
 * `server-only` is imported for its side effect: it fails the build if this
 * module is ever pulled into a client bundle, which is the difference between
 * a rule about where tokens may live and a rule that is enforced.
 */

export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return bff.sessionFor(jar.get(SESSION_COOKIE)?.value);
}

/** Redirects rather than throwing: an expired session is not a server error. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/api/session/login');
  return session;
}

export function apiFor(session: Session): Portal {
  return portal(bff.clientFor(session));
}
