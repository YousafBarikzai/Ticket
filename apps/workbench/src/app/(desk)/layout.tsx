import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { demoPersona, demoPersonaForArea } from '@itsm/contracts/demo';
import type { Me, Workbench } from '@itsm/sdk';
import { Button, StatusScreen } from '@itsm/ui';
import { ContextChip } from '@itsm/ui/shell';
import { DeskProviders } from '../../components/DeskProviders.js';
import { DeskShell, type DeskPermissions } from '../../components/DeskShell.js';
import { isTenantSuspended } from '../../inbox/presentation.js';
import { LAST_VIEW_COOKIE, deskTopics } from '../../inbox/views.js';
import { deskFrame, incidentChip, type FrameIncident } from '../../navigation.js';
import { bff } from '../../bff.js';
import { apiFor, currentAreas, currentMe, currentSession, currentTeams, heldPermissions } from '../../server/session.js';
import { settle } from '../../server/settle.js';
import { demoBarClock } from '../demo/clock.js';
import { DemoBarSlot } from '../demo/DemoBarSlot.js';

/**
 * Everything behind a session: the Service Desk frame (v3 §3.4, §3.5; SPEC
 * §5.1, §5.3).
 *
 * The route group exists so that `/sign-in`, `/signed-out`, `/demo` and
 * `/offline` are not wrapped in a frame that needs the session they are there
 * to obtain — a layout that redirects to sign-in, rendered by the sign-in
 * page, is an infinite loop and a classic one.
 *
 * One `/me` (shared with the page through `cache()`), the tenant's teams for
 * the sidebar, the person's areas, and the frame's one live fact — a running
 * major incident — then plain data for the client frame: the navigation, the
 * tabs, the palette's places and the links out (`navigation.ts`), names,
 * team ids and permission booleans. No function crosses to the client. A
 * suspended workspace is a full-screen state of its own (F7), not an error
 * page; any other failure to read the person reaches the root error
 * boundary, which offers Try again.
 *
 * In a demo session the demo bar heads the frame (v3 §3.8), with the clock
 * computed here, the persona from the table and the generation of the
 * session as the BFF last re-minted it (X3).
 */

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

/** `SEV1` first; among equals, the most recently declared. */
function bySeverity(a: { severity: string; declaredAt: string }, b: { severity: string; declaredAt: string }): number {
  return a.severity.localeCompare(b.severity) || b.declaredAt.localeCompare(a.declaredAt);
}

/**
 * The running major incidents the person may read, most severe first, for
 * the top bar's chip (A2 §5.2.4). The first one's ticket is read only while
 * the chip links there (the war room is still pending, RV6). A failed read
 * shows no chip rather than failing the frame: the chip is context, never
 * the page.
 */
async function frameIncidents(api: Workbench, held: ReadonlySet<string>): Promise<FrameIncident[]> {
  if (!held.has('incident.major.read')) return [];
  const listed = await settle(() => api.majorIncidents({ open: true }));
  if (!listed.ok || listed.value.length === 0) return [];
  const rows = [...listed.value].sort(bySeverity);
  const incidents: FrameIncident[] = rows.map((row) => ({ number: row.number, title: row.title, severity: row.severity, ticketId: null }));
  const chip = incidentChip(incidents);
  if (chip && !chip.href) {
    const detail = await settle(() => api.majorIncident(rows[0]!.number));
    if (detail.ok) incidents[0] = { ...incidents[0]!, ticketId: detail.value.ticketId };
  }
  return incidents;
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
  const session = await currentSession();
  // Names for the person's own teams; without the teams route the section is
  // hidden rather than listing ids.
  const [tenantTeams, areas, incidents, jar] = await Promise.all([
    can.readTickets ? currentTeams() : null,
    currentAreas(),
    session ? frameIncidents(apiFor(session), held) : [],
    cookies(),
  ]);
  const names = new Map((tenantTeams ?? []).map((team) => [team.id.toLowerCase(), team.name]));
  const teams = me.teamIds
    .map((id) => ({ id: id.toLowerCase(), name: names.get(id.toLowerCase()) }))
    .filter((team): team is { id: string; name: string } => typeof team.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name, me.locale));

  const frame = deskFrame({ held, teams, areas, lastView: jar.get(LAST_VIEW_COOKIE)?.value ?? null });
  const chip = incidentChip(incidents);
  const persona = areas.demo ? (demoPersona(session?.persona) ?? demoPersonaForArea('workbench')) : null;
  const generation = session ? bff.latestSession(session).demoGeneration : undefined;

  return (
    <DeskProviders
      locale={me.locale}
      timeZone={me.timeZone}
      {...(me.actor.id ? { storageScope: me.actor.id } : {})}
      topics={deskTopics(me.teamIds)}
    >
      <DeskShell
        areas={areas}
        frame={frame}
        {...(me.tenant ? { workspace: me.tenant.name } : {})}
        systemBar={
          persona ? (
            <DemoBarSlot
              variant="session"
              clock={demoBarClock()}
              persona={{ name: persona.name, title: persona.title }}
              {...(generation !== undefined ? { generation } : {})}
              areas={areas}
            />
          ) : undefined
        }
        context={chip ? <ContextChip tone="danger" icon="siren" {...chip} /> : undefined}
        user={{
          id: me.actor.id,
          name: me.actor.displayName ?? 'Signed in',
          // Line 2: the persona's title in a demo, else the organisation, else the workspace (§3.4).
          ...(persona ? { detail: persona.title } : me.organisations[0] ? { detail: me.organisations[0].name } : me.tenant ? { detail: me.tenant.name } : {}),
        }}
        teams={teams}
        can={can}
      >
        {children}
      </DeskShell>
    </DeskProviders>
  );
}
