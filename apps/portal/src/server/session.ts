import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, safeRedirectTarget, type Session } from '@itsm/bff';
import { ApiError, portal, type ApprovalRequest, type Me, type Portal } from '@itsm/sdk';
import { withoutAnswered } from '../approvals/server.js';
import { bff } from '../bff.js';
import { PATH_HEADER } from '../proxy.js';

/**
 * How a server component gets at the API.
 *
 * Server components call the API directly with the session's token; the proxy
 * exists so the *browser* never holds one. Going through it here would mean
 * the app making an HTTP request to itself on every render.
 *
 * Each read is wrapped in `cache()`, so the `(portal)` layout and the page
 * under it share one session lookup, one `/me` and one approvals call per
 * request (F6) — Home used to ask for the approvals a second time, and the
 * profile and request pages for `/me` again.
 *
 * `server-only` is imported for its side effect: it fails the build if this
 * module is ever pulled into a client bundle, which is the difference between
 * a rule about where tokens may live and a rule that is enforced.
 */

export const currentSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  return bff.sessionFor(jar.get(SESSION_COOKIE)?.value);
});

/**
 * Where "sign in again" goes: the login route, told to come back to the page
 * the person was on (F5). The path is the one the proxy saw, so a session
 * that expired overnight still lands on the request that was open, not on
 * Home.
 */
export async function loginHref(): Promise<string> {
  const path = safeRedirectTarget((await headers()).get(PATH_HEADER), bff.config.defaultLanding);
  return `/api/session/login?redirectTo=${encodeURIComponent(path)}`;
}

/** Redirects rather than throwing: an expired session is not a server error. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect(await loginHref());
  return session;
}

export function apiFor(session: Session): Portal {
  return portal(bff.clientFor(session));
}

/**
 * The signed-in person, once per request. A 401 is a session the API no
 * longer honours — sign in again, keeping the page. Anything else is thrown
 * for the caller: the frame shows a suspended workspace its own way, and any
 * other failure is the error page's.
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

/** Whether a failure is the workspace being suspended (SPEC §4.10, F7): a full-screen state, not an error. */
export function isTenantSuspended(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const type = error.problem?.type ?? '';
  return type.slice(type.lastIndexOf('/') + 1) === 'tenant_suspended';
}

/** The permission keys the person holds, whatever their scope. */
export function heldPermissions(me: Me): ReadonlySet<string> {
  return new Set(me.permissions.map((permission) => permission.key));
}

/**
 * What is waiting on this person's decision, once per request — for the
 * avatar's count, the Approvals row and Home's pinned "Approval waiting" row.
 *
 * `null` without `approval.read` (the call is not even made) and when the
 * approvals module could not answer: a count that failed must not take the
 * frame with it, and must not read as "nothing waiting" either.
 *
 * Undecided only. `includeDecided` is left out rather than sent as `false`
 * (the API once read `false` as true, F34), and anything already decided is
 * dropped here as well, so a stale or older API cannot put a decision back in
 * somebody's count. So is a step this person has already answered that still
 * waits on a second approver (`withoutAnswered`, WP29): it is not waiting on
 * *them*.
 */
export const currentApprovals = cache(async (): Promise<readonly ApprovalRequest[] | null> => {
  const me = await currentMe();
  if (!heldPermissions(me).has('approval.read')) return null;
  const session = await requireSession();
  try {
    const api = apiFor(session);
    const page = await api.approvals({});
    const open = page.data.filter((approval) => approval.decidedAt === null && approval.status === 'pending');
    return await withoutAnswered(api, me.actor.id, open);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(await loginHref());
    return null;
  }
});
