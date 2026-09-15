import { defineHandler, newId } from '@itsm/platform';
import { recordElapsed } from '../service/entry-service.js';

/**
 * The automatic kind: how long a ticket sat in each status.
 *
 * A span opens when a ticket enters a status and closes when it leaves. On
 * leaving a working state — category `open` — the span's length is recorded
 * against the assignee as elapsed time, priced at nothing. Paused states
 * (waiting on the requester) and settled ones are measured but not recorded:
 * time spent waiting is not time anybody worked.
 */

defineHandler({
  consumer: 'time',
  moduleId: 'MOD-19',
  eventType: 'ticket.created',
  required: false,
  async handle(ctx, event, tx) {
    const { ticketId } = event.payload as { ticketId: string };
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId }, select: { status: true, statusCategory: true, createdAt: true } });
    if (!ticket) return;
    const open = await tx.ticketStatusSpan.findFirst({ where: { ticketId, exitedAt: null } });
    if (open) return;
    await tx.ticketStatusSpan.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId, status: ticket.status, category: ticket.statusCategory, enteredAt: ticket.createdAt },
    });
  },
});

defineHandler({
  consumer: 'time',
  moduleId: 'MOD-19',
  eventType: 'ticket.status.changed',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string; to: string; toCategory: string };
    const at = new Date(event.occurredAt);

    const open = await tx.ticketStatusSpan.findFirst({ where: { ticketId: payload.ticketId, exitedAt: null }, orderBy: { enteredAt: 'desc' } });
    if (open) {
      await tx.ticketStatusSpan.update({ where: { id: open.id }, data: { exitedAt: at } });
      if (open.category === 'open') {
        await recordElapsed(ctx, tx, { ticketId: payload.ticketId, from: open.enteredAt, to: at });
      }
    }

    await tx.ticketStatusSpan.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: payload.ticketId, status: payload.to, category: payload.toCategory, enteredAt: at },
    });
  },
});
