import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, safeRedirectTarget, type Session } from '@itsm/bff';
import { areasFor } from '@itsm/bff/areas';
import type { AreaModel } from '@itsm/contracts/areas';
import { DEMO_PERSONA_FOR_AREA, demoEntryHref, signInAgainHref } from '@itsm/contracts/demo';
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

/** The page the proxy saw this request ask for (`x-itsm-path`), or the area's home. */
async function currentPath(): Promise<string> {
  return safeRedirectTarget((await headers()).get(PATH_HEADER), bff.config.defaultLanding);
}

/**
 * Where "sign in again" goes: the login route, told to come back to the page
 * the person was on (F5). The path is the one the proxy saw, so an expired
 * session caught in a layout still lands on the deep link, not on the
 * Overview.
 *
 * In a demo visit the link says so (`&demo=1`, `signInAgainHref`): the BFF
 * then reopens the demo through `/demo` rather than sending a visitor to an
 * identity provider they have no account with (§4.5 L2, L3; A3-S2). Unless
 * told otherwise, a demo session on this request decides it.
 */
export async function loginHref(options: { readonly demo?: boolean } = {}): Promise<string> {
  const demo = options.demo ?? (await currentSession())?.kind === 'demo';
  return signInAgainHref(await currentPath(), { demo });
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

/** A session younger than this whose `/me` is refused is not sent round again by itself: the loop breaker of §4.6.4. */
export const DEMO_REENTRY_GRACE_MS = 30_000;

/**
 * Where a demo visit the API stopped honouring goes (§4.6.4, A3 §6.8): back
 * through this app's `/demo`, which re-enters the demo and returns to the
 * page. Same-origin, so `/demo` submits by itself (P7, "Welcome back —
 * reopening the demo…"). A session minted moments ago that is refused again
 * gets the reason page instead, with a button and no auto-submit, so a demo
 * the API cannot serve never becomes a redirect loop.
 */
export function demoReentryHref(path: string, session: Pick<Session, 'createdAt'>, now: number = Date.now()): string {
  const entry = demoEntryHref('', DEMO_PERSONA_FOR_AREA.workbench, path);
  return now - session.createdAt < DEMO_REENTRY_GRACE_MS ? `${entry}&reason=unavailable` : `${entry}&resumed=1`;
}

/** Whether a refused demo request handed the person's own session back (WP-30's X3 `restored: true`). */
function restoredOwnSession(error: ApiError): boolean {
  const problem: unknown = error.problem;
  return typeof problem === 'object' && problem !== null && (problem as { readonly restored?: unknown }).restored === true;
}

/**
 * The signed-in person, once per request. A 401 here is a session the API no
 * longer honours (revoked, or the token outlived its refresh): sign in again,
 * keeping the page. Any other failure is thrown for the caller to decide —
 * the frame shows a suspended workspace its own way, and anything else is an
 * error page.
 *
 * A demo visit is told apart (§4.6.4): a 401 re-enters the demo at the same
 * page, a 503 `demo_unavailable` shows `/demo`'s reason page, and a visit
 * that ended by handing back the person's own session (they were signed in
 * before they explored) reloads the page as themselves.
 */
export const currentMe = cache(async (): Promise<Me> => {
  const session = await requireSession();
  try {
    return await apiFor(session).me();
  } catch (error) {
    if (error instanceof ApiError && session.kind === 'demo') {
      const path = await currentPath();
      if (error.status === 401) redirect(restoredOwnSession(error) ? path : demoReentryHref(path, session));
      if (error.status === 503 && error.code === 'demo_unavailable') {
        redirect(`${demoEntryHref('', DEMO_PERSONA_FOR_AREA.workbench, path)}&reason=unavailable`);
      }
    }
    if (error instanceof ApiError && error.status === 401) redirect(await loginHref());
    throw error;
  }
});

/** The permission keys the person holds, whatever their scope. */
export function heldPermissions(me: Me): ReadonlySet<string> {
  return new Set(me.permissions.map((permission) => permission.key));
}

/**
 * The person's areas (v3 §3.1): the Area card, the account menu's Switch
 * area, the palette's group, and every link that leaves the Service Desk.
 * The one place this app builds the model; `areasFor` is the one place it
 * reads the deployment's origins. A demo visit names the generation's
 * re-minted session (`latestSession`), so the persona lines follow a reset.
 */
export const currentAreas = cache(async (): Promise<AreaModel> => {
  const [me, session] = await Promise.all([currentMe(), currentSession()]);
  return areasFor({
    app: 'workbench',
    held: heldPermissions(me),
    session: session ? bff.latestSession(session) : null,
    ...(me.tenant ? { workspace: me.tenant.name } : {}),
    ...(me.demo ? { agentTeamIds: me.demo.agentTeamIds } : {}),
  });
});

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
