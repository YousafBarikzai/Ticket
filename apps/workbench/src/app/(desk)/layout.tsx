import type { ReactNode } from 'react';
import type { Me } from '@itsm/sdk';
import { Button, StatusScreen } from '@itsm/ui';
import type { AppSwitcherItem } from '@itsm/ui/shell';
import { DeskProviders } from '../../components/DeskProviders.js';
import { DeskShell, type DeskPermissions } from '../../components/DeskShell.js';
import { isTenantSuspended } from '../../inbox/presentation.js';
import { deskTopics } from '../../inbox/views.js';
import { currentMe, currentTeams, heldPermissions } from '../../server/session.js';

/**
 * Everything behind a session: the workbench frame (SPEC §5.1, §5.3).
 *
 * The route group exists so that `/sign-in`, `/signed-out` and `/offline` are
 * not wrapped in a frame that needs the session they are there to obtain — a
 * layout that redirects to sign-in, rendered by the sign-in page, is an
 * infinite loop and a classic one.
 *
 * One `/me` (shared with the page through `cache()`), the tenant's teams for
 * the sidebar, and then plain data for the client frame: names, team ids and
 * permission booleans. No function crosses to the client. A suspended
 * workspace is a full-screen state of its own (F7), not an error page; any
 * other failure to read the person reaches the root error boundary, which
 * offers Try again.
 */

/** Anyone with one of these can use the admin console for something. */
const ADMIN_PERMISSIONS = [
  'admin.setting.read',
  'admin.setting.manage',
  'admin.flag.manage',
  'identity.user.manage',
  'rules.rule.read',
  'workflow.manage',
  'sla.policy.read',
  'analytics.read',
  'audit.read',
  'integration.action.read',
  'catalogue.manage',
  'ticket.config.manage',
  'platform.tenant.read',
];

/** The other applications this person can use, same tab (X-83). Hidden where the deployment has not said where they live. */
function switcherFor(held: ReadonlySet<string>): AppSwitcherItem[] {
  const portal = process.env.PORTAL_ORIGIN?.trim();
  const admin = process.env.ADMIN_ORIGIN?.trim();
  return [
    { app: 'workbench', label: 'Workbench', href: '/inbox' },
    ...(portal && (held.has('ticket.create') || held.has('catalogue.read')) ? [{ app: 'portal' as const, label: 'Help portal', href: portal }] : []),
    ...(admin && ADMIN_PERMISSIONS.some((key) => held.has(key)) ? [{ app: 'admin' as const, label: 'Administration', href: admin }] : []),
  ];
}

function permissionsFor(held: ReadonlySet<string>): DeskPermissions {
  return {
    readTickets: held.has('ticket.read'),
    createTickets: held.has('ticket.create'),
    search: held.has('search.query'),
    readPeople: held.has('identity.user.read'),
    readAvailability: held.has('workload.read'),
    setAvailability: held.has('workload.availability.set'),
  };
}

function Suspended(): ReactNode {
  return (
    <StatusScreen
      brand="workbench"
      illustration="forbidden"
      title="This workspace is suspended"
      body="Nobody can use it until it’s restored. Contact your provider to find out more."
    >
      <form method="post" action="/api/session/logout">
        <Button type="submit" variant="secondary" size="lg" fullWidth>
          Sign out
        </Button>
      </form>
    </StatusScreen>
  );
}

export default async function DeskLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  let me: Me;
  try {
    me = await currentMe();
  } catch (error) {
    if (isTenantSuspended(error)) return <Suspended />;
    throw error;
  }

  const held = heldPermissions(me);
  const can = permissionsFor(held);
  // Names for the person's own teams; without the teams route the section is
  // hidden rather than listing ids.
  const tenantTeams = can.readTickets ? await currentTeams() : null;
  const names = new Map((tenantTeams ?? []).map((team) => [team.id.toLowerCase(), team.name]));
  const teams = me.teamIds
    .map((id) => ({ id: id.toLowerCase(), name: names.get(id.toLowerCase()) }))
    .filter((team): team is { id: string; name: string } => typeof team.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name, me.locale));

  return (
    <DeskProviders
      locale={me.locale}
      timeZone={me.timeZone}
      {...(me.actor.id ? { storageScope: me.actor.id } : {})}
      topics={deskTopics(me.teamIds)}
    >
      <DeskShell
        {...(me.tenant ? { tenantName: me.tenant.name } : {})}
        switcher={switcherFor(held)}
        user={{
          id: me.actor.id,
          name: me.actor.displayName ?? 'Signed in',
          ...(me.tenant ? { detail: me.tenant.name } : {}),
        }}
        teams={teams}
        can={can}
      >
        {children}
      </DeskShell>
    </DeskProviders>
  );
}
