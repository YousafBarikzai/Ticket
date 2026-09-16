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
 * The navigation is the brief's eleven sections, in its order. Two of them are
 * not what the brief's words might suggest and the difference is worth stating:
 * "Tickets" is a read-only view of every ticket on the desk, not a second
 * workbench — an administrator who wants to *work* one should be where the
 * timeline and the reply box are; and "Services and CMDB" covers the estate,
 * while the services people can ask for stay in the catalogue builder it
 * links to.
 *
 * Configuration keeps the two screens that were separate before — the shape of
 * a ticket, and settings — because folding them into one page would have made
 * a longer page rather than a simpler console. People sits under Security in
 * the brief's scheme and is reachable from both.
 *
 * Every item is gated on the permission its screen actually needs, and a
 * withheld item is absent rather than disabled. That is presentation, not a
 * control: the API refuses regardless, and a URL can always be typed.
 */

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Any one of these is enough. A screen that shows two lists needs either. */
  readonly permissions: readonly string[];
}

const ENTRIES: readonly Entry[] = [
  { id: 'overview', label: 'Command centre', href: '/', permissions: [] },
  { id: 'queues', label: 'Queues', href: '/queues', permissions: ['workload.read', 'workload.manage'] },
  { id: 'tickets', label: 'Tickets', href: '/tickets', permissions: ['ticket.read'] },
  {
    id: 'cmdb',
    label: 'Services and CMDB',
    href: '/cmdb',
    permissions: ['cmdb.read', 'cmdb.manage', 'asset.read', 'asset.manage'],
  },
  {
    id: 'automation',
    label: 'Automation',
    href: '/automation',
    permissions: ['rules.rule.read', 'rules.rule.manage', 'workflow.read', 'workflow.manage'],
  },
  { id: 'sla', label: 'SLA management', href: '/sla', permissions: ['sla.policy.read', 'sla.policy.manage'] },
  { id: 'insights', label: 'Insights', href: '/insights', permissions: ['analytics.read', 'analytics.manage'] },
  {
    id: 'integrations',
    label: 'Integrations',
    href: '/integrations',
    permissions: [
      'integration.action.read',
      'integration.action.manage',
      'integration.credential.read',
      'integration.credential.manage',
    ],
  },
  {
    id: 'settings',
    label: 'Configuration',
    href: '/settings',
    permissions: ['admin.setting.read', 'admin.setting.manage', 'ticket.config.manage', 'catalogue.manage'],
  },
  {
    id: 'security',
    label: 'Security',
    href: '/security',
    permissions: ['security.alert.read', 'identity.role.manage', 'identity.user.read', 'identity.user.manage'],
  },
  { id: 'audit', label: 'Audit', href: '/audit', permissions: ['audit.read'] },
];

export default async function AdminLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { me } = await currentActor();
  const operator = holds(me, 'platform.tenant.manage');

  const navItems = ENTRIES.filter(
    (entry) => entry.permissions.length === 0 || entry.permissions.some((permission) => holds(me, permission)),
  ).map((entry) => ({ id: entry.id, label: entry.label, href: entry.href }));

  return (
    <AppShell
      brand={
        <span>
          <strong>Administration</strong>
          {me.tenant ? <span className="itsm-AppShell__tenant"> · {me.tenant.name}</span> : null}
        </span>
      }
      navItems={[
        ...navItems,
        // The platform section is not part of the brief's list and is not part
        // of this tenant either. It appears only for an operator, and its own
        // layout refuses everybody else regardless — a hidden link is not a
        // permission check.
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
