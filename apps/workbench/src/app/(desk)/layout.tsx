import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@itsm/ui';
import { apiFor, currentSession } from '../../server/session.js';
import { DeskCommands } from '../../components/DeskCommands.js';
import { OfflineStatus } from '../../components/OfflineStatus.js';
import { SignOutButton } from '../../components/SignOutButton.js';

/**
 * Everything behind a session.
 *
 * The route group exists so that `/sign-in` and `/signed-out` are not wrapped
 * in a shell that needs the session they are there to obtain — a layout that
 * redirects to sign-in, rendered by the sign-in page, is an infinite loop and
 * a classic one.
 */

export default async function DeskLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const session = await currentSession();
  if (!session) redirect('/api/session/login');

  // One call, in the layout rather than in each page: `me` is what decides
  // which navigation exists at all, and fetching it per page would render a
  // menu the person cannot use and then take it away.
  const me = await apiFor(session).me();
  const held = new Set(me.permissions.map((permission) => permission.key));

  const nav = [
    { id: 'queue', label: 'Queue', href: '/queue' },
    ...(held.has('ticket.read') ? [{ id: 'mine', label: 'Assigned to me', href: '/queue?assignee=me' }] : []),
    ...(held.has('ticket.read') ? [{ id: 'unassigned', label: 'Unassigned', href: '/queue?assignee=none' }] : []),
  ];

  return (
    <AppShell
      brand={
        <span>
          <strong>Workbench</strong>
          {me.tenant ? <span className="itsm-AppShell__tenant"> · {me.tenant.name}</span> : null}
        </span>
      }
      navItems={nav}
      headerEnd={
        <>
          <DeskCommands canSearch={held.has('search.query')} />
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
