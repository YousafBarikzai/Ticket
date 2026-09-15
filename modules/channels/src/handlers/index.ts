import { defineHandler, logger } from '@itsm/platform';
import { outboundSubject, outboundMessageId, TICKET_HEADER } from '../domain/threading.js';
import { transportForAccount } from '../service/transport-registry.js';

/**
 * The outbound half of the adapter pattern (docs/architecture/07 §5).
 *
 * A public reply on a ticket fans out to every conversation that ticket has, on
 * every channel. That fan-out is what makes cross-channel continuity real: a
 * requester who raised a ticket by email and was later added to a Slack thread
 * sees the same reply in both.
 */

defineHandler({
  consumer: 'channels',
  moduleId: 'MOD-03',
  eventType: 'ticket.comment.added',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as {
      ticketId: string;
      number: string;
      commentId: string;
      visibility: string;
      channel?: string;
    };

    // Internal notes never leave the platform. This is the single line standing
    // between an agent's private note and the requester's inbox.
    if (payload.visibility !== 'public') return;

    const conversations = await tx.conversation.findMany({ where: { ticketId: payload.ticketId } });
    if (conversations.length === 0) return;

    const comment = await tx.ticketComment.findFirst({ where: { id: payload.commentId } });
    if (!comment) return;

    // A message that arrived on a channel must not be echoed back to it.
    if (comment.channel && comment.channel === payload.channel) return;

    const ticket = await tx.ticket.findFirst({ where: { id: payload.ticketId } });
    if (!ticket) return;

    for (const conversation of conversations) {
      if (conversation.channel !== 'email') continue;

      const account = await tx.channelAccount.findFirst({ where: { id: conversation.accountId } });
      if (!account) continue;

      const transport = await transportForAccount(account.config ?? { transport: 'development' }, ctx);
      if (!transport) {
        // Not sent through some other provider instead: a tenant on Graph chose
        // it so their mail stays inside their own Microsoft geography, and
        // quietly sending through Postmark would break exactly that.
        logger.warn('this mailbox has no usable transport; the reply was not sent', {
          account: account.key,
          ticket: payload.number,
        });
        continue;
      }

      const requester = ticket.requesterId
        ? await tx.user.findFirst({ where: { id: ticket.requesterId } })
        : null;
      if (!requester) continue;

      const sequence = (await tx.ticketComment.count({ where: { ticketId: ticket.id } })) || 1;
      const domain = account.address.split('@')[1] ?? 'localhost';

      await transport.sendMessage({
        to: requester.email,
        subject: outboundSubject(ticket.number, ticket.title),
        body: comment.body,
        headers: {
          'Message-ID': outboundMessageId(ticket.number, sequence, domain),
          // Stamped so the reply comes back to the right ticket without relying
          // on the subject, which people edit, or on References, which a
          // forward loses.
          [TICKET_HEADER]: ticket.number,
          ...(conversation.externalThreadId ? { 'In-Reply-To': conversation.externalThreadId } : {}),
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastOutboundAt: new Date() },
      });
    }
  },
});
