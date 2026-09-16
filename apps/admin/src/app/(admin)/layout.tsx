import type { ReactNode } from 'react';
import { AppShell } from '@itsm/ui';
import { SignOutButton } from '../../components/SignOutButton.js';
import { currentActor } from '../../server/session.js';
import { holds } from '../../permissions.js';

/**
 * Everything behind a session.
 *
 * The route group exists so `/sign-in` and `/signed-out` are not wrapped in a
 * shell that needs the session they are there to obtain — a layout that
 * redirects to sign-in, rendered by the sign-in page, is an infinite loop and
 * a classic one.
 *
 * The navigation is organised by what an administrator is trying to set up
 * rather than by which module owns the table underneath. "The shape of a
 * ticket" is MOD-04 and MOD-02, and nobody configuring a desk should have to
 * know that.
 *
 * The platform link appears only for somebody holding `platform.tenant.manage`,
 * and that is presentation rather than a control: the section's own layout
 * refuses everybody else regardless. A hidden link is not a permission check,
 * and a URL can be typed.
 */
export default async function AdminLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { me } = await currentActor();
  const operator = holds(me, 'platform.tenant.manage');

  return (
    <AppShell
      brand={
        <span>
          <strong>Administration</strong>
          {me.tenant ? <span className="itsm-AppShell__tenant"> · {me.tenant.name}</span> : null}
        </span>
      }
      navItems={[
        { id: 'overview', label: 'Overview', href: '/' },
        { id: 'people', label: 'People', href: '/people' },
        { id: 'fields', label: 'The shape of a ticket', href: '/fields' },
        { id: 'catalogue', label: 'What people can ask for', href: '/catalogue' },
        { id: 'settings', label: 'Settings', href: '/settings' },
        ...(operator ? [{ id: 'platform', label: 'Platform', href: '/tenants' }] : []),
      ]}
      navLabel="Administration"
      headerEnd={
        <>
          <span className="itsm-AppShell__who">{me.actor.displayName ?? 'Signed in'}</span>
          <SignOutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
