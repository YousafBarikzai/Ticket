import { defineHandler } from '@itsm/platform';
import { aclForTicket, indexDocument } from '../service/search-service.js';

/**
 * MOD-09 keeps the search projection in step with the ticket record. Because
 * the projection is rebuilt from these same events, a lost index is a replay
 * rather than a data-recovery problem (ADR-0003).
 */
const TICKET_EVENTS = ['ticket.created', 'ticket.updated', 'ticket.status.changed'] as const;

for (const eventType of TICKET_EVENTS) {
  defineHandler({
    consumer: 'search',
    moduleId: 'MOD-09',
    eventType,
    required: true,
    async handle(ctx, event, tx) {
      const { ticketId } = event.payload as { ticketId: string };
      const ticket = await tx.ticket.findFirst({ where: { id: ticketId, deletedAt: null } });
      if (!ticket) return;

      const watchers = await tx.ticketWatcher.findMany({ where: { ticketId } });
      await indexDocument(tx, ctx, {
        entityType: 'ticket',
        entityId: ticket.id,
        title: `${ticket.number} ${ticket.title}`,
        bodyText: [ticket.title, ticket.description ?? ''].join('\n'),
        orgId: ticket.orgId,
        acl: aclForTicket(ticket, watchers.map((w) => w.userId)),
        facets: {
          type: ticket.type,
          status: ticket.status,
          statusCategory: ticket.statusCategory,
          priority: ticket.priority,
          number: ticket.number,
        },
        sourceUpdatedAt: ticket.updatedAt,
      });
    },
  });
}
