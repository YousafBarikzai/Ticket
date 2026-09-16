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

  const nav = [
    { id: 'home', label: 'Home', href: '/' },
    ...(held.has('catalogue.read') ? [{ id: 'catalogue', label: 'Request something', href: '/catalogue' }] : []),
    { id: 'tickets', label: 'My tickets', href: '/tickets' },
    ...(held.has('approval.read')
      ? [{ id: 'approvals', label: 'Approvals', href: '/approvals', ...(waiting > 0 ? { badge: waiting } : {}) }]
      : []),
    ...(held.has('knowledge.read') ? [{ id: 'knowledge', label: 'Help articles', href: '/knowledge' }] : []),
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
