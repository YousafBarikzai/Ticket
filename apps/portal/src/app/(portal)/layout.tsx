import type { ReactNode } from 'react';
import type { Me } from '@itsm/sdk';
import { AREAS, type AreaId, type AreaModel } from '@itsm/contracts/areas';
import { DEMO_COPY, demoPersona, demoPersonaForArea } from '@itsm/contracts/demo';
import { Button, StatusScreen } from '@itsm/ui';
import { bff } from '../../bff.js';
import { PortalProviders } from '../../components/PortalProviders.js';
import { PortalShell } from '../../components/PortalShell.js';
import { portalCan, portalFrame } from '../../navigation.js';
import { currentApprovals, currentAreas, currentMe, heldPermissions, isTenantSuspended, requireSession } from '../../server/session.js';
import { DEMO_ENDED_BODY, demoClock } from '../demo/server.js';

/**
 * Everything behind a session: the portal frame (SPEC §5.1, §5.4; v3 §3.6–§3.8).
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
 * from the person's permissions, the person's areas, booleans. No function
 * crosses to the client.
 *
 * **The areas** (`currentAreas()`) are the only thing that knows where the
 * Service Desk and Administration live; the frame draws the switcher (or the
 * lockup for a requester) and the account menu's Switch area group from them.
 * **In a demo visit** the demo bar sits above the frame: the persona, the
 * countdown to the nightly reset (computed here, from the pure UK clock) and
 * the generation this page was read from (after any re-mint in this request,
 * X3). It is the lazy bar, so a real tenant's pages carry none of it.
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

/** Under the name in the account menu: in a demo the persona's title, else the person's organisation, else the workspace. */
function detailOf(me: Me): string | undefined {
  if (me.demo) return (demoPersona(me.demo.persona) ?? demoPersonaForArea('portal')).title;
  return me.organisations[0]?.name ?? me.tenant?.name ?? undefined;
}

/** Each listed area's search words, for the palette (the table stays on the server). */
function keywordsOf(areas: AreaModel): Partial<Record<AreaId, readonly string[]>> {
  return Object.fromEntries(areas.areas.map((link) => [link.id, AREAS[link.id].keywords]));
}

export default async function PortalLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  let me: Me;
  try {
    me = await currentMe();
  } catch (error) {
    if (isTenantSuspended(error)) return <Suspended />;
    throw error;
  }

  const [session, areas] = await Promise.all([requireSession(), currentAreas()]);
  const held = heldPermissions(me);
  const can = portalCan(held);
  const approvals = can.readApprovals ? await currentApprovals() : null;
  const waiting = approvals?.length ?? 0;
  const detail = detailOf(me);

  const persona = areas.demo ? (demoPersona(session.persona) ?? demoPersonaForArea('portal')) : null;
  const generation = bff.latestSession(session).demoGeneration;
  const demo = persona
    ? {
        bar: { clock: demoClock(), persona: { name: persona.name, title: persona.title }, ...(generation !== undefined ? { generation } : {}) },
        ended: { title: DEMO_COPY.sessionEnded, description: DEMO_ENDED_BODY, action: DEMO_COPY.continueDemo },
      }
    : undefined;

  return (
    <PortalProviders locale={me.locale} timeZone={me.timeZone} {...(me.actor.id ? { storageScope: me.actor.id } : {})}>
      <PortalShell
        user={{ id: me.actor.id, name: me.actor.displayName ?? 'Signed in', ...(detail ? { detail } : {}) }}
        areas={areas}
        areaKeywords={keywordsOf(areas)}
        frame={portalFrame(can, waiting)}
        can={can}
        approvalsWaiting={waiting}
        renderedAt={new Date().toISOString()}
        {...(demo ? { demo } : {})}
      >
        {children}
      </PortalShell>
    </PortalProviders>
  );
}
