import { defineHandler } from '@itsm/platform';
import { inviteForTrigger } from '../service/invitation-service.js';

/**
 * MOD-18 listens for outcomes.
 *
 * "Resolved" is the moment, not "closed": closure happens days later, by a
 * timer, when the person has stopped thinking about it. A request is a
 * resolved ticket of type `request`, so fulfilment is the same event read
 * with the type in hand rather than a second event nobody publishes.
 */

defineHandler({
  consumer: 'feedback',
  moduleId: 'MOD-18',
  eventType: 'ticket.status.changed',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string; fromCategory: string; toCategory: string };
    const settled = new Set(['resolved', 'closed']);
    // The first time it settles. A reopen-and-resolve is caught by the
    // once-per-ticket rule anyway, but not asking twice starts here.
    if (!settled.has(payload.toCategory) || settled.has(payload.fromCategory)) return;

    const ticket = await tx.ticket.findFirst({ where: { id: payload.ticketId }, select: { type: true } });
    if (!ticket) return;

    const kind = ticket.type === 'request' ? 'request.fulfilled' : 'ticket.resolved';
    await inviteForTrigger(ctx, tx, kind, { ticketId: payload.ticketId, actorId: event.actor.id ?? null });
  },
});

defineHandler({
  consumer: 'feedback',
  moduleId: 'MOD-18',
  eventType: 'incident.major.resolved',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { incidentId: string; severity: string; ticketId: string | null };
    // A major incident is rated through the ticket that raised it; one with no
    // ticket has no requester to ask.
    if (!payload.ticketId) return;
    await inviteForTrigger(ctx, tx, 'incident.major.resolved', {
      ticketId: payload.ticketId,
      incidentId: payload.incidentId,
      actorId: event.actor.id ?? null,
      incident: { severity: payload.severity },
    });
  },
});
