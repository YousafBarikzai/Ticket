import { Suspense, type ReactNode } from 'react';
import type { Me } from '@itsm/sdk';
import { StatusScreen } from '@itsm/ui';
import type { AppSwitcherItem } from '@itsm/ui/shell';
import { AdminShell } from '../../components/AdminShell.js';
import { NavBadges } from '../../components/NavBadges.js';
import { Providers } from '../../components/Providers.js';
import { holdsAny } from '../../permissions.js';
import { currentPath, loadActor, signInHref } from '../../server/session.js';

/**
 * Everything behind a session: tenant pages and platform pages alike, in one
 * persistent frame (SPEC D18, §5.2). An operator moving from Rules to Tenants
 * keeps the sidebar, the palette and the bell; the platform section's own
 * `notFound()` gate stays in `(platform)/layout.tsx`, below this one.
 *
 * The route group exists so that `/sign-in` and `/signed-out` are not wrapped
 * in a frame that needs the session they are there to obtain — a layout that
 * redirects to sign-in, rendered by the sign-in page, is an infinite loop.
 *
 * In order:
 *
 *   1. A session, or sign in — coming back to this page afterwards (F5).
 *   2. Who is signed in, once per request (`cache()`, shared with the page and
 *      the badges; F6). Three answers are not a person, and each gets a
 *      screen of its own instead of Next's error page: the session ended at
 *      the API (sign in again, by choice — an identity provider that signs
 *      people straight back in would otherwise loop), the workspace is
 *      suspended (F7), or the API cannot be reached.
 *   3. The frame, with the navigation built for this person, and the sidebar
 *      counts streamed in beside it so they never hold up first paint.
 *
 * No `loading.tsx` sits beside this file: one here would wrap the platform
 * layout too, and a platform 404 has to keep its status (Y-1.3.3). The generic
 * skeleton is `(admin)/loading.tsx`.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const load = await loadActor();

  if (load.kind === 'ended') {
    return (
      <StatusScreen
        brand="admin"
        title="Your session ended"
        body="Sign in again to carry on where you left off."
        actions={[{ id: 'sign-in', label: 'Sign in again', icon: 'log-in', href: signInHref(await currentPath()) }]}
      />
    );
  }

  if (load.kind === 'suspended') {
    return (
      <StatusScreen
        brand="admin"
        illustration="forbidden"
        title="This workspace is suspended"
        body="Nobody can use it until it’s restored. Contact your provider to find out more."
      >
        {/* Signing out is a state change: a POST, never a link a prefetcher could follow. */}
        <form method="post" action="/api/session/logout">
          <button type="submit" className="itsm-Button itsm-Button--secondary itsm-Button--lg">
            <span className="itsm-Button__label">Sign out</span>
          </button>
        </form>
      </StatusScreen>
    );
  }

  if (load.kind === 'unavailable') {
    // A 429 is an answer, not silence: say the desk is busy, and for how long, rather than unreachable.
    const busy = load.problem.status === 429;
    const seconds = load.problem.retryAfterSeconds;
    return (
      <StatusScreen
        brand="admin"
        illustration="offline"
        errorBoundary
        title={busy ? 'The desk is busy right now' : 'Can’t reach the desk right now'}
        body={
          busy
            ? `Too many requests reached the service at once. Try again ${seconds ? `in ${seconds} s` : 'in a moment'}.`
            : 'The service didn’t answer. Nothing you did caused this; try again in a moment.'
        }
        actions={[{ id: 'retry', label: 'Try again', icon: 'refresh-cw', href: await currentPath() }]}
      />
    );
  }

  const { me } = load;
  const workbenchOrigin = originOf(process.env.WORKBENCH_ORIGIN);
  const portalOrigin = originOf(process.env.PORTAL_ORIGIN);
  const detail = me.organisations[0]?.name ?? me.tenant?.name;

  return (
    <Providers locale={me.locale} timeZone={me.timeZone} {...(me.actor.id ? { storageScope: me.actor.id } : {})}>
      <AdminShell
        person={{ name: me.actor.displayName ?? 'Signed in', ...(detail ? { detail } : {}) }}
        tenant={me.tenant ? { name: me.tenant.name } : null}
        permissions={me.permissions}
        switcher={switcherFor(me, workbenchOrigin, portalOrigin)}
        {...(workbenchOrigin ? { workbenchOrigin } : {})}
        {...(portalOrigin ? { helpHref: `${portalOrigin}/knowledge` } : {})}
      >
        {children}
      </AdminShell>
      <Suspense fallback={null}>
        <NavBadges />
      </Suspense>
    </Providers>
  );
}

/** An origin from the environment, without a trailing slash; nothing when unset or not a URL (C1). */
function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * The applications this person can switch to, same tab (SPEC §4.10). Only
 * those they can use: the workbench for people who work tickets, the portal
 * for everyone. Without the other origins configured there is nothing to
 * switch to, and the brand is a plain label rather than a menu.
 */
function switcherFor(me: Me, workbench: string | undefined, portal: string | undefined): AppSwitcherItem[] {
  const items: AppSwitcherItem[] = [{ app: 'admin', label: 'Administration', href: '/' }];
  if (workbench && holdsAny(me, ['ticket.update', 'ticket.comment.internal'])) items.push({ app: 'workbench', label: 'Workbench', href: workbench });
  if (portal) items.push({ app: 'portal', label: 'Help portal', href: portal });
  return items.length > 1 ? items : [];
}
