import 'server-only';
import { cache } from 'react';
import type { Me, Ticket, Workbench } from '@itsm/sdk';
import { bundlePeopleIds, permissionsFrom, type TicketBundle } from '../../../../client/desk-ticket.js';
import { resolvePeople } from '../../../../server/people.js';
import { apiFor, heldPermissions, requireSession } from '../../../../server/session.js';

/**
 * One ticket, assembled on the server (SPEC §6.2, D16): shared by the page
 * (a hard load seeds the client's cache with it) and by
 * `GET /api/desk/tickets/[id]` (every client read after that), so the two
 * can never disagree about what a bundle holds.
 *
 * Three reads start together — the reader, the timeline (which carries the
 * ticket) and the SLA timers — then one batched lookup names the people in
 * it. The timers may fail on their own (a tenant without the SLA module, a
 * reader without the right to see them): the ticket is still worth showing.
 */
export async function loadTicketBundle(api: Workbench, idOrNumber: string, me?: Me): Promise<TicketBundle> {
  const [viewer, timeline, timers] = await Promise.all([
    me ? Promise.resolve(me) : api.me(),
    api.timeline(idOrNumber),
    api.slaTimers(idOrNumber).then(
      (answer) => answer.timers,
      () => null,
    ),
  ]);
  const people = await resolvePeople(bundlePeopleIds(timeline.ticket, timeline.entries));
  const viewerId = viewer.actor.id?.toLowerCase() ?? null;
  return {
    ticket: timeline.ticket,
    entries: timeline.entries,
    attachments: timeline.attachments ?? [],
    includesInternal: timeline.includesInternal,
    includesEvents: timeline.includesEvents,
    timers,
    people,
    viewer: {
      id: viewerId,
      name: viewer.actor.displayName ?? 'You',
      teamIds: viewer.teamIds.map((id) => id.toLowerCase()),
      can: permissionsFrom(heldPermissions(viewer), timeline.includesInternal),
    },
    loadedAt: new Date().toISOString(),
  };
}

/**
 * The ticket alone, once per request: the layout's gate (404, the number
 * URL) and the page's `<title>` share it.
 */
export const gateTicket = cache(async (idOrNumber: string): Promise<Ticket> => {
  const session = await requireSession();
  return apiFor(session).ticket(idOrNumber);
});
