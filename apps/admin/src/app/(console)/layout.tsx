import { Suspense, type ReactNode } from 'react';
import { crossAreaHref } from '@itsm/contracts/areas';
import { StatusScreen } from '@itsm/ui';
import { ContextChip } from '@itsm/ui/shell';
import { AdminShell } from '../../components/AdminShell.js';
import { NavBadges } from '../../components/NavBadges.js';
import { Providers } from '../../components/Providers.js';
import { holds } from '../../permissions.js';
import {
  areaKeywords,
  currentAreas,
  currentPath,
  demoBarFor,
  demoEntryFor,
  loadActor,
  majorIncidentChip,
  majorIncidentReads,
  signInHref,
  type Actor,
} from '../../server/session.js';
import { LazySessionDemoBar } from '../demo/bars.js';

/**
 * Everything behind a session: tenant pages and platform pages alike, in one
 * persistent frame (SPEC D18, §5.2; v3 §3.4). An operator moving from Rules to
 * Tenants keeps the sidebar, the palette and the bell; the platform section's
 * own `notFound()` gate stays in `(platform)/layout.tsx`, below this one.
 *
 * The route group exists so that `/sign-in`, `/signed-out` and `/demo` are not
 * wrapped in a frame that needs the session they are there to obtain — a
 * layout that redirects to sign-in, rendered by the sign-in page, is an
 * infinite loop.
 *
 * In order:
 *
 *   1. A session, or sign in — coming back to this page afterwards (F5).
 *   2. Who is signed in, once per request (`cache()`, shared with the page and
 *      the badges; F6). Three answers are not a person, and each gets a
 *      screen of its own instead of Next's error page: the session ended at
 *      the API (sign in again, by choice — an identity provider that signs
 *      people straight back in would otherwise loop; in the demo, *Continue
 *      the demo*), the workspace is suspended (F7), or the API cannot be
 *      reached. A demo visit the BFF ended or handed back is redirected
 *      before any of this (`loadActor`, §4.6.4).
 *   3. The frame, with the person's areas (`currentAreas()`, the one place
 *      the other areas' origins are read), the demo bar in a demo visit, the
 *      live major incident's chip and the sidebar counts — the last two
 *      streamed in beside it so they never hold up first paint.
 *
 * No `loading.tsx` sits beside this file: one here would wrap the platform
 * layout too, and a platform 404 has to keep its status (Y-1.3.3). The generic
 * skeleton is `(admin)/loading.tsx`.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const load = await loadActor();

  if (load.kind === 'ended') {
    const path = await currentPath();
    // The demo's own words (§4.6.4): a visit is never "signed in" to, and *Continue the demo* goes back through
    // `/demo`, which reopens it from this origin without an identity provider in sight.
    return load.demo ? (
      <StatusScreen
        brand="admin"
        title="Your demo session ended"
        body="Pick up where you left off — the demo data may have been reset since."
        actions={[{ id: 'continue-demo', label: 'Continue the demo', icon: 'play', href: demoEntryFor(path) }]}
      />
    ) : (
      <StatusScreen
        brand="admin"
        title="Your session ended"
        body="Sign in again to carry on where you left off."
        actions={[{ id: 'sign-in', label: 'Sign in again', icon: 'log-in', href: signInHref(path) }]}
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

  const { me, session } = load;
  const areas = await currentAreas();
  const demoBar = areas.demo ? demoBarFor(session) : null;
  // Line 2 of the account card: in the demo the persona's job title ("IT Service Manager"), otherwise the organisation.
  const detail = demoBar ? demoBar.persona.title : (me.organisations[0]?.name ?? me.tenant?.name);
  // Tickets are worked in the Service Desk; a demo visit cannot know a notification's team (X-B2), so it stays here.
  const serviceDeskTickets = areas.demo ? null : crossAreaHref(areas, 'workbench', '/tickets/');

  return (
    <Providers locale={me.locale} timeZone={me.timeZone} {...(me.actor.id ? { storageScope: me.actor.id } : {})}>
      <AdminShell
        person={{ name: me.actor.displayName ?? 'Signed in', ...(detail ? { detail } : {}) }}
        permissions={me.permissions}
        areas={areas}
        areaKeywords={areaKeywords()}
        links={{ knowledge: crossAreaHref(areas, 'portal', '/knowledge'), serviceDeskTickets }}
        systemBar={demoBar ? <LazySessionDemoBar variant="session" {...demoBar} areas={areas} /> : undefined}
        context={
          holds(me, 'incident.major.read') ? (
            <Suspense fallback={null}>
              <FrameChip actor={load} />
            </Suspense>
          ) : undefined
        }
      >
        {children}
      </AdminShell>
      <Suspense fallback={null}>
        <NavBadges />
      </Suspense>
    </Providers>
  );
}

/**
 * The live major incident, in the top bar ahead of the page's own chips
 * (SPEC v3 §3.4). Streamed: its two or three reads never hold up the frame,
 * and a failed read draws nothing.
 */
async function FrameChip({ actor }: { readonly actor: Actor }): Promise<ReactNode> {
  const chip = await majorIncidentChip(majorIncidentReads(actor.api), await currentAreas());
  if (!chip) return null;
  return <ContextChip label={chip.label} compactLabel={chip.compactLabel} icon="siren" tone="danger" {...(chip.href ? { href: chip.href } : {})} />;
}
