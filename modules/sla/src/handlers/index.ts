import { defineHandler, logger } from '@itsm/platform';
import { STATES } from '@itsm/module-ticket';
import {
  meetTimer,
  pauseTimers,
  rematchTimersForTicket,
  resumeTimers,
  startTimersForTicket,
  stopTimers,
} from '../service/timer-service.js';

/**
 * MOD-07 reacts to the ticket lifecycle.
 *
 * The state machine decides what happens to timers; this module only carries it
 * out. That keeps one description of "pending pauses the resolution clock"
 * rather than two that can drift apart.
 */

defineHandler({
  consumer: 'sla',
  moduleId: 'MOD-07',
  eventType: 'ticket.created',
  required: true,
  async handle(ctx, event, tx) {
    const { ticketId } = event.payload as { ticketId: string };
    await startTimersForTicket(ctx, tx, ticketId);
  },
});

/**
 * A ticket classified after it was raised — an AI decision in `auto` mode
 * setting its category or team (ADR-0051) — is matched again. The clock that
 * started at creation keeps running; only the targets may change.
 */
defineHandler({
  consumer: 'sla',
  moduleId: 'MOD-07',
  eventType: 'ticket.classified',
  required: true,
  async handle(ctx, event, tx) {
    const { ticketId } = event.payload as { ticketId: string };
    await rematchTimersForTicket(ctx, tx, ticketId);
  },
});

defineHandler({
  consumer: 'sla',
  moduleId: 'MOD-07',
  eventType: 'ticket.status.changed',
  required: true,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string; to: string; toCategory: string };
    const definition = STATES[payload.to as keyof typeof STATES];
    if (!definition) {
      logger.warn('unknown state on status change; timers unchanged', { to: payload.to });
      return;
    }

    switch (definition.sla.resolutionTimer) {
      case 'paused':
        await pauseTimers(ctx, tx, payload.ticketId, definition.sla.pauseReason ?? 'pending_requester');
        break;
      case 'running':
        await resumeTimers(ctx, tx, payload.ticketId);
        break;
      case 'stopped':
        await stopTimers(ctx, tx, payload.ticketId, 'met');
        break;
      case 'cancelled':
        await stopTimers(ctx, tx, payload.ticketId, 'cancelled');
        break;
    }
  },
});

defineHandler({
  consumer: 'sla',
  moduleId: 'MOD-07',
  eventType: 'ticket.comment.added',
  required: true,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string; visibility: string; authorId: string | null };
    // The first public reply from someone other than the requester is what the
    // response target measures, so only that stops the clock.
    if (payload.visibility !== 'public') return;
    const ticket = await tx.ticket.findFirst({ where: { id: payload.ticketId } });
    if (!ticket || ticket.requesterId === payload.authorId) return;
    await meetTimer(ctx, tx, payload.ticketId, 'response');
  },
});
