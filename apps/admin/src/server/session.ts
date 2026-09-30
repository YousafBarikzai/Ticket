import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE, safeRedirectTarget, type Session } from '@itsm/bff';
import { admin, type Admin, type Me } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import { bff } from '../bff.js';
import { pageEntry } from '../navigation.js';
import { holds, holdsAny } from '../permissions.js';
import { isSessionEnded, isTenantSuspended, problemFrom } from '../problem.js';

/**
 * How a server component gets at the API, and who is asking.
 *
 * Server components call the API *directly* rather than through this app's own
 * proxy: the proxy exists so the browser never holds a token, and a server
 * component already holds the session. Going through the proxy would be the
 * app making an HTTP request to itself on every render.
 *
 * `server-only` is imported for its side effect: it is a module that fails to
 * build if it is ever pulled into a client bundle, which is the difference
 * between a rule about where tokens may live and a rule that is enforced.
 *
 * Every read here is wrapped in React's `cache()`, so the layout, the page and
 * the streamed badges share one session lookup and one `/me` per request —
 * there used to be two or three (F6). `cache()` lasts for one request on the
 * server, so nothing leaks from one person's render to the next.
 */

/** The request header `src/proxy.ts` sets to the path and query being asked for. */
export const PATH_HEADER = 'x-itsm-path';

/**
 * The path this request is for, safe to send back to as a `redirectTo`.
 *
 * Set by the proxy on every page request; anything not a same-origin path —
 * including a header a client set itself — reads as the Command centre.
 */
export const currentPath = cache(async (): Promise<string> => safeRedirectTarget((await headers()).get(PATH_HEADER), '/'));

/** Where to sign in so that the person comes back to `path` afterwards (F5). */
export function signInHref(path: string): string {
  return `/api/session/login?redirectTo=${encodeURIComponent(path)}`;
}

export const currentSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  return bff.sessionFor(jar.get(SESSION_COOKIE)?.value);
});

/**
 * Redirects rather than throwing. A page that threw would render a 500, and
 * "your session expired" is not a server error. The deep link survives: the
 * sign-in comes back to the page the person asked for.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect(signInHref(await currentPath()));
  return session;
}

/** The SDK, bound to this request's session. */
export function apiFor(session: Session): Admin {
  return admin(bff.clientFor(session));
}

export interface Actor {
  readonly session: Session;
  readonly me: Me;
  readonly api: Admin;
}

/**
 * The signed-in person, or why there is none to show.
 *
 * - `ok`: who, what they may do, and the SDK bound to them.
 * - `ended`: the session cookie resolved but the API refused the token —
 *   revoked, or signed out elsewhere. Shown as a screen with *Sign in again*
 *   rather than redirected automatically: an identity provider that signs
 *   people straight back in would otherwise loop.
 * - `suspended`: the API refuses every call for this workspace (F7), so the
 *   frame shows one screen instead of every section failing on its own.
 * - `unavailable`: the API could not be reached; the frame says so and offers
 *   to try again, rather than letting Next's default error page through.
 */
export type ActorLoad =
  | ({ readonly kind: 'ok' } & Actor)
  | { readonly kind: 'ended' }
  | { readonly kind: 'suspended' }
  | { readonly kind: 'unavailable'; readonly problem: Problem };

export const loadActor = cache(async (): Promise<ActorLoad> => {
  const session = await requireSession();
  const api = apiFor(session);
  try {
    return { kind: 'ok', session, me: await api.me(), api };
  } catch (error) {
    if (isSessionEnded(error)) return { kind: 'ended' };
    if (isTenantSuspended(error)) return { kind: 'suspended' };
    return { kind: 'unavailable', problem: problemFrom(error) };
  }
});

/**
 * The signed-in person, for code that runs only once the frame has shown it
 * can. Throws otherwise — which never reaches the screen, because the
 * `(console)` layout renders its own state and no page under it.
 */
export async function currentActor(): Promise<Actor> {
  const load = await loadActor();
  if (load.kind !== 'ok') throw new Error(`The signed-in person could not be loaded (${load.kind}).`);
  return load;
}

/**
 * The page gate, read from `navigation.ts` — so a page is open to exactly the
 * people its sidebar item is shown to (SPEC §5.1; `navigation.test.ts` checks
 * that every page calls this with its own route).
 *
 * ```tsx
 * const access = await pageAccess('/rules');
 * if (!access.allowed) return <Forbidden route="/rules" />;
 * const { me, api } = access;
 * ```
 *
 * Not allowed is a value, not a throw, so the page keeps its header and says
 * which permission to ask for (the Forbidden view). A route the map does not
 * know is closed: a page added without a gate should fail its test, not open
 * to everyone.
 */
export type PageAccess = ({ readonly allowed: true } & Actor) | { readonly allowed: false; readonly me: Me | null };

export async function pageAccess(route: string): Promise<PageAccess> {
  const load = await loadActor();
  // The frame is already showing why nobody is signed in; the page renders nothing that matters.
  if (load.kind !== 'ok') return { allowed: false, me: null };
  const entry = pageEntry(route);
  if (!entry || !holdsAny(load.me, entry.read)) return { allowed: false, me: load.me };
  return { allowed: true, session: load.session, me: load.me, api: load.api };
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
export async function requirePlatformOperator(): Promise<Actor> {
  const load = await loadActor();
  if (load.kind !== 'ok' || !holds(load.me, 'platform.tenant.manage')) notFound();
  return load;
}
