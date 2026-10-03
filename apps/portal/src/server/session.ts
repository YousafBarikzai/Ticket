import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, isDemoSession, safeRedirectTarget, type Session } from '@itsm/bff';
import { areasFor } from '@itsm/bff/areas';
import type { AreaModel } from '@itsm/contracts/areas';
import { DEMO_PERSONA_FOR_AREA, DEMO_PROBLEM_CODES, demoEntryHref, signInAgainHref } from '@itsm/contracts/demo';
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
 * A demo visit (SPEC v3 §4.6.4) never meets the identity provider: when the
 * API stops honouring it, the page goes back through this app's `/demo`
 * entry, which mints a fresh visit for the same persona and lands on the page
 * the person was reading.
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
 * The page the person asked for, as the proxy saw it (the layouts cannot see
 * the URL). A session that expired overnight still lands on the request that
 * was open, not on Home.
 */
async function requestedPath(): Promise<string> {
  return safeRedirectTarget((await headers()).get(PATH_HEADER), bff.config.defaultLanding);
}

/**
 * Where "sign in again" goes: the login route, told to come back to the page
 * the person was on (F5). In a demo visit the link carries `demo=1`, so the
 * BFF reopens the demo rather than sending a visitor to an identity provider
 * they have no account with (§4.5 L2–L3, A3-S2).
 */
export async function loginHref(options: { readonly demo?: boolean } = {}): Promise<string> {
  return signInAgainHref(await requestedPath(), options);
}

/**
 * A demo visit younger than this that the API already refuses is not sent
 * round again automatically: `/demo` shows its "session ended" button instead,
 * so a demo that cannot mint never loops between here and `/demo` (§4.6.4).
 */
export const DEMO_LOOP_BREAKER_MS = 30_000;

/**
 * `/demo?persona=employee&demo=1&…&redirectTo=<path>`: back through this
 * app's own entry, same-origin, so it submits itself (P7) — `resumed=1`
 * changes only the words ("Welcome back — reopening the demo…"). A visit the
 * API refused within its first half-minute, or a demo that is unavailable,
 * gets `reason=unavailable`: a button, never another automatic round trip.
 */
export function demoReentryHref(session: Pick<Session, 'createdAt'>, path: string, now: number, unavailable = false): string {
  const base = demoEntryHref('', DEMO_PERSONA_FOR_AREA.portal, path);
  return unavailable || now - session.createdAt < DEMO_LOOP_BREAKER_MS ? `${base}&reason=unavailable` : `${base}&resumed=1`;
}

/** The problem's extension member `restored`: the person's own session came back when the visit ended (X3). */
function restoredOwnSession(error: ApiError): boolean {
  return (error.problem as { readonly restored?: unknown } | null)?.restored === true;
}

/**
 * What a page does when an API read fails with a session problem, before
 * anything else sees the error. Redirects (which throw) or returns, so the
 * caller rethrows what is not a session problem.
 *
 *   - **A real session** the API no longer honours (401): sign in again,
 *     keeping the page.
 *   - **A demo visit that ended** (401): back through `/demo`, or — when the
 *     visit gave the person's own session back (`restored: true`) — the same
 *     page again, now in their own account.
 *   - **The demo unavailable** (503 `demo_unavailable`) in a demo visit:
 *     `/demo` with the reason, which says so and offers a button.
 */
async function redirectOnSessionProblem(session: Session, error: unknown): Promise<void> {
  if (!(error instanceof ApiError)) return;
  if (!isDemoSession(session)) {
    if (error.status === 401) redirect(await loginHref());
    return;
  }
  if (error.status === 401) {
    const path = await requestedPath();
    if (restoredOwnSession(error)) redirect(path);
    redirect(demoReentryHref(session, path, Date.now()));
  }
  if (error.status === 503 && error.code === DEMO_PROBLEM_CODES.unavailable) {
    redirect(demoReentryHref(session, await requestedPath(), Date.now(), true));
  }
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
 * longer honours — sign in again, keeping the page (or, in a demo visit, go
 * back through `/demo`). Anything else is thrown for the caller: the frame
 * shows a suspended workspace its own way, and any other failure is the
 * error page's.
 */
export const currentMe = cache(async (): Promise<Me> => {
  const session = await requireSession();
  try {
    return await apiFor(session).me();
  } catch (error) {
    await redirectOnSessionProblem(session, error);
    throw error;
  }
});

/**
 * The person's areas for this request (SPEC v3 §3.1, `currentAreas()`): the
 * Help Portal always; the Service Desk and Administration by their gates; all
 * three, with their personas, in a demo visit. Built on the server from the
 * deployment's origins — the only place this app reads them — and handed to
 * the frame and pages as plain data. Every link into another area comes from
 * it (`crossAreaHref`), so a demo visit's links go through the sibling's
 * `/demo` and never straight to a page that visit cannot open.
 */
export const currentAreas = cache(async (): Promise<AreaModel> => {
  const session = await requireSession();
  const me = await currentMe();
  return areasFor({
    app: 'portal',
    held: heldPermissions(me),
    session,
    ...(me.tenant?.name ? { workspace: me.tenant.name } : {}),
    ...(me.demo?.agentTeamIds ? { agentTeamIds: me.demo.agentTeamIds } : {}),
  });
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
    if (error instanceof ApiError && error.status === 401) await redirectOnSessionProblem(session, error);
    return null;
  }
});
