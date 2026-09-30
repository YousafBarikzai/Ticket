import type { ReactNode } from 'react';
import type { Me } from '@itsm/sdk';
import { Button, StatusScreen } from '@itsm/ui';
import { PortalProviders } from '../../components/PortalProviders.js';
import { PortalShell } from '../../components/PortalShell.js';
import { portalCan, portalFrame, switcherFor } from '../../navigation.js';
import { currentApprovals, currentMe, heldPermissions, isTenantSuspended } from '../../server/session.js';

/**
 * Everything behind a session: the portal frame (SPEC §5.1, §5.4).
 *
 * The route group exists so that `/sign-in`, `/signed-out` and `/offline` are
 * not wrapped in a frame that needs the session they are there to obtain — a
 * layout that redirects to sign-in, rendered by the sign-in page, is an
 * infinite loop and a classic one.
 *
 * One `/me` and one approvals call, both shared with the page under it
 * through `cache()` (F6). The approvals call is skipped without
 * `approval.read`, leaves decided ones out (F34), and failing softly: an
 * approvals module that is unavailable must not take the navigation with it.
 * Then plain data for the client frame — names, the navigation model built
 * from the person's permissions, booleans. No function crosses to the
 * client.
 *
 * A suspended workspace is a full-screen state of its own (F7), not an
 * error page; any other failure to read the person reaches the root error
 * boundary, which offers Try again.
 */

function Suspended(): ReactNode {
  return (
    <StatusScreen
      brand="portal"
      illustration="forbidden"
      title="This workspace is suspended"
      body="Nobody can use it until it’s restored. Your IT team can tell you more."
    >
      <form method="post" action="/api/session/logout">
        <Button type="submit" variant="secondary" size="lg" fullWidth>
          Sign out
        </Button>
      </form>
    </StatusScreen>
  );
}

/** Under the name in the avatar menu: the person's organisation, else the workspace. */
function detailOf(me: Me): string | undefined {
  return me.organisations[0]?.name ?? me.tenant?.name ?? undefined;
}

export default async function PortalLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  let me: Me;
  try {
    me = await currentMe();
  } catch (error) {
    if (isTenantSuspended(error)) return <Suspended />;
    throw error;
  }

  const held = heldPermissions(me);
  const can = portalCan(held);
  const approvals = can.readApprovals ? await currentApprovals() : null;
  const waiting = approvals?.length ?? 0;
  const detail = detailOf(me);

  return (
    <PortalProviders locale={me.locale} timeZone={me.timeZone} {...(me.actor.id ? { storageScope: me.actor.id } : {})}>
      <PortalShell
        user={{ id: me.actor.id, name: me.actor.displayName ?? 'Signed in', ...(detail ? { detail } : {}) }}
        {...(me.tenant ? { tenantName: me.tenant.name } : {})}
        frame={portalFrame(can, waiting)}
        switcher={switcherFor(held, { workbench: process.env.WORKBENCH_ORIGIN, admin: process.env.ADMIN_ORIGIN })}
        can={can}
        approvalsWaiting={waiting}
        renderedAt={new Date().toISOString()}
      >
        {children}
      </PortalShell>
    </PortalProviders>
  );
}
