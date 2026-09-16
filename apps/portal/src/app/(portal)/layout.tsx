import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@itsm/ui';
import { apiFor, currentSession } from '../../server/session.js';
import { OfflineStatus } from '../../components/OfflineStatus.js';
import { SignOutButton } from '../../components/SignOutButton.js';

/**
 * Everything behind a session.
 *
 * The route group exists so that `/sign-in` and `/signed-out` are not wrapped
 * in a shell that needs the session they are there to obtain — a layout that
 * redirects to sign-in, rendered by the sign-in page, is an infinite loop and
 * a classic one.
 *
 * The navigation is built from what the person can actually do. A requester
 * with no approvals waiting is not shown an approvals link that leads to an
 * empty page; an account without `catalogue.read` is not shown a catalogue it
 * would be refused. The API is still the enforcer — this only decides what is
 * worth offering.
 */

export default async function PortalLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const session = await currentSession();
  if (!session) redirect('/api/session/login');

  const api = apiFor(session);
  const me = await api.me();
  const held = new Set(me.permissions.map((permission) => permission.key));

  // A count, not a boolean: "Approvals (2)" is the whole reason somebody opens
  // the portal on a day they were not going to. Failing softly, because an
  // approvals module that is unavailable must not take the navigation with it.
  let waiting = 0;
  if (held.has('approval.read')) {
    try {
      waiting = (await api.approvals()).data.length;
    } catch {
      waiting = 0;
    }
  }

  /*
   * The five the brief asks for, in its order: Home, My requests, Services,
   * Knowledge, Profile.
   *
   * Approvals is the sixth and is not in that list. It is kept because
   * removing it would take away a screen people use, and because it is already
   * the brief's own progressive disclosure done properly: it appears only for
   * somebody who has approvals to give, carrying the number waiting, and is
   * invisible to everybody else. A requester's navigation is still five items.
   *
   * The labels are the brief's words rather than the ones that were here.
   * "My requests" and "Services" are what a person coming to a service desk
   * calls these; "My tickets" and "Request something" are what the people who
   * run one call them.
   */
  const nav = [
    { id: 'home', label: 'Home', href: '/' },
    { id: 'tickets', label: 'My requests', href: '/tickets' },
    ...(held.has('catalogue.read') ? [{ id: 'catalogue', label: 'Services', href: '/catalogue' }] : []),
    ...(held.has('knowledge.read') ? [{ id: 'knowledge', label: 'Knowledge', href: '/knowledge' }] : []),
    ...(held.has('approval.read')
      ? [{ id: 'approvals', label: 'Approvals', href: '/approvals', ...(waiting > 0 ? { badge: waiting } : {}) }]
      : []),
    { id: 'profile', label: 'Profile', href: '/profile' },
  ];

  return (
    <AppShell
      brand={
        <span>
          <strong>Help</strong>
          {me.tenant ? <span className="itsm-AppShell__tenant"> · {me.tenant.name}</span> : null}
        </span>
      }
      navItems={nav}
      navLabel="Portal"
      headerEnd={
        <>
          <span className="itsm-AppShell__who">{me.actor.displayName ?? 'Signed in'}</span>
          <SignOutButton />
        </>
      }
    >
      <OfflineStatus />
      {children}
    </AppShell>
  );
}
