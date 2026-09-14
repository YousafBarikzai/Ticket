import { defineHandler, logger, recordAudit } from '@itsm/platform';

/**
 * MOD-04 reacts to other modules' events that change the ticket record itself.
 */

defineHandler({
  consumer: 'ticket',
  moduleId: 'MOD-04',
  eventType: 'user.deactivated',
  required: true,
  async handle(ctx, event, tx) {
    const { userId } = event.payload as { userId: string };
    // A leaver's open work goes back to the group rather than disappearing into
    // an inactive account (MOD-01-E3-S1).
    const affected = await tx.ticket.updateMany({
      where: { assigneeId: userId, statusCategory: { in: ['open', 'paused'] } },
      data: { assigneeId: null },
    });
    if (affected.count > 0) {
      logger.info('unassigned open tickets from a deactivated user', { userId, count: affected.count });
      await recordAudit(tx, ctx, {
        action: 'ticket.unassigned.deactivated_user',
        targetType: 'user',
        targetId: userId,
        after: { unassigned: affected.count },
      });
    }
  },
});

defineHandler({
  consumer: 'ticket',
  moduleId: 'MOD-04',
  eventType: 'ticket.attachment.scanned',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { ticketId: string; attachmentId: string; verdict: string };
    if (payload.verdict === 'clean') return;
    // An infected upload is recorded on the timeline so the agent can see why
    // the file they were promised is not there.
    const { newId } = await import('@itsm/platform');
    await tx.ticketEvent.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ticketId: payload.ticketId,
        type: 'attachment.quarantined',
        actorType: 'system',
        actorId: null,
        payload: { attachmentId: payload.attachmentId, verdict: payload.verdict } as never,
      },
    });
  },
});
