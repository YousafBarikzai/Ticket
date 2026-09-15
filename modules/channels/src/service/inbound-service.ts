import {
  type TenantContext,
  type Tx,
  ValidationError,
  logger,
  metrics,
  newId,
  recordAudit,
  systemContext,
  transaction,
  withContext,
  platformDb,
} from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { guardInbound, type InboundCandidate } from '../domain/loop-guard.js';
import { guardChat, type ChatEvent } from '../domain/chat-guard.js';
import { resolveThread, stripQuotedReply, subjectToken } from '../domain/threading.js';
import { requiresVerifiedIdentity, type ChannelCommand, type RejectionReason } from '../domain/commands.js';

/**
 * The inbound path, shared by every channel (docs/architecture/07 §5).
 *
 * Provider webhook → verify → record → normalise → resolve identity → execute.
 * Each step is separable because the PH-4 adapters reuse all of it: only the
 * parsing differs between an email and a Slack event.
 *
 * Nothing here calls a repository. Commands are carried out through the same
 * services the HTTP API uses, under a real TenantContext, so a message that
 * arrives by email is subject to exactly the permissions and the audit trail
 * that the same request would be through the API.
 */

export interface ParsedInbound {
  channel: string;
  externalMessageId: string;
  fromAddress: string;
  subject: string | null;
  body: string | null;
  headers: Record<string, string | undefined>;
  sizeBytes: number;
  raw: unknown;
  /**
   * Present for a chat channel, which has none of the headers the email guard
   * reads and an entirely different set of ways to go wrong.
   */
  chat?: ChatEvent;
}

export interface AcceptResult {
  status: 'accepted' | 'rejected' | 'duplicate';
  reason?: RejectionReason;
  detail?: string;
  messageId?: string;
  ticketNumber?: string;
}

/** Resolves which tenant an account belongs to, before any tenant context exists. */
export async function resolveAccountTenant(
  channel: string,
  address: string,
): Promise<{ tenantId: string; accountId: string; config: unknown } | null> {
  // The directory lookup runs on the platform role: at this point there is no
  // tenant context to run it in, which is precisely why channel_directory is on
  // the platform table allowlist.
  //
  // The account's config comes back with it because since PH-3 each mailbox
  // chooses its own provider, and the delivery has to be verified with *that*
  // provider's rules. Looking up which mailbox a request claims to be for is
  // not the same as trusting the request: nothing is accepted until the
  // verification that follows.
  const rows = await platformDb().$queryRaw<{ tenant_id: string; id: string; config: unknown }[]>`
    SELECT tenant_id, id, config FROM channel_account
    WHERE channel = ${channel} AND lower(address) = lower(${address}) AND status = 'active'
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { tenantId: row.tenant_id, accountId: row.id, config: row.config } : null;
}

/**
 * Accepts one provider delivery.
 *
 * Idempotent on the provider's own message id: the same delivery retried — which
 * every provider does — records once and executes once.
 */
export async function acceptInbound(parsed: ParsedInbound, address: string): Promise<AcceptResult> {
  const account = await resolveAccountTenant(parsed.channel, address);
  if (!account) {
    metrics.increment('channel_inbound_rejected_total', { channel: parsed.channel, reason: 'unknown_account' });
    return { status: 'rejected', reason: 'unknown_account', detail: address };
  }

  const ctx = systemContext(account.tenantId, { actor: { type: 'channel', id: null, displayName: parsed.channel } });

  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const existing = await tx.inboundMessage.findFirst({
        where: { channel: parsed.channel, externalMessageId: parsed.externalMessageId },
      });
      if (existing) {
        metrics.increment('channel_inbound_duplicates_total', { channel: parsed.channel });
        return { status: 'duplicate' as const, messageId: existing.id };
      }

      const accountRow = await tx.channelAccount.findFirst({ where: { id: account.accountId } });
      if (!accountRow) return { status: 'rejected' as const, reason: 'unknown_account' as const };

      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await tx.inboundMessage.count({
        where: { fromAddress: parsed.fromAddress.toLowerCase(), receivedAt: { gte: since }, status: 'processed' },
      });

      const config = (accountRow.config ?? {}) as {
        maxBytes?: number;
        maxPerSenderPerHour?: number;
        botUserId?: string;
        allowedBotIds?: string[];
      };

      // Two guards, one decision. A chat channel has no RFC 3834 headers and a
      // different set of ways to go wrong, so it gets the guard written for it
      // rather than the email one applied loosely.
      const verdict = parsed.chat
        ? guardChat(parsed.chat, {
            ownBotUserId: config.botUserId ?? null,
            ...(config.allowedBotIds ? { allowedBotIds: config.allowedBotIds } : {}),
            // Chat messages are small; the email default would let somebody
            // paste a novel into a channel and have it become a ticket.
            maxBytes: config.maxBytes ?? 64 * 1024,
            recentFromSender: recent,
            maxPerSenderPerHour: config.maxPerSenderPerHour ?? 30,
          })
        : guardInbound(
            {
              headers: parsed.headers,
              subject: parsed.subject,
              body: parsed.body,
              fromAddress: parsed.fromAddress,
              sizeBytes: parsed.sizeBytes,
            } satisfies InboundCandidate,
            {
              maxBytes: config.maxBytes ?? 25 * 1024 * 1024,
              ownAddresses: [accountRow.address],
              recentFromSender: recent,
              maxPerSenderPerHour: config.maxPerSenderPerHour ?? 30,
            },
          );

      const messageId = newId();
      await tx.inboundMessage.create({
        data: {
          id: messageId,
          tenantId: ctx.tenantId,
          accountId: accountRow.id,
          channel: parsed.channel,
          externalMessageId: parsed.externalMessageId,
          fromAddress: parsed.fromAddress.toLowerCase(),
          subject: parsed.subject,
          body: parsed.body,
          raw: (parsed.raw ?? {}) as never,
          status: verdict.accept ? 'received' : 'rejected',
          rejectedReason: verdict.reason ?? null,
        },
      });

      await tx.channelAccount.update({
        where: { id: accountRow.id },
        data: { lastMessageAt: new Date() },
      });

      if (!verdict.accept) {
        // Recorded rather than discarded: "37 rejected" tells nobody anything,
        // "37 auto-replies from one address" tells them what to go and fix.
        metrics.increment('channel_inbound_rejected_total', { channel: parsed.channel, reason: verdict.reason! });
        logger.info('inbound message rejected', {
          channel: parsed.channel,
          reason: verdict.reason,
          detail: verdict.detail,
        });
        return { status: 'rejected' as const, reason: verdict.reason, detail: verdict.detail, messageId };
      }

      metrics.increment('channel_inbound_accepted_total', { channel: parsed.channel });
      return { status: 'accepted' as const, messageId };
    }),
  );
}

/** Turns an accepted message into the command it represents. */
export function normalise(parsed: ParsedInbound): ChannelCommand {
  const thread = resolveThread(parsed.headers, parsed.subject);
  const body = stripQuotedReply(parsed.body ?? '');

  if (thread.kind === 'header-token' || thread.kind === 'subject-token') {
    return { kind: 'addComment', ticketRef: thread.ticketRef, body };
  }
  if (thread.kind === 'references') {
    // Resolved against stored message ids when the command is executed; if none
    // matches it becomes a new ticket there.
    return { kind: 'addComment', ticketRef: thread.messageIds.join(' '), body };
  }
  return { kind: 'createTicket', subject: parsed.subject?.trim() || '(no subject)', body };
}

export interface ExecutionResult {
  outcome: 'created' | 'commented' | 'refused';
  ticketNumber?: string;
  reason?: string;
}

/**
 * Carries out a command as the person the channel identity maps to.
 *
 * An unverified sender may only ask to be linked. "What is the status of
 * REQ-000123" from a forged address is a data leak, and "add a comment" from one
 * is a way to put words in somebody's mouth, so both are refused before the
 * command reaches a service.
 */
export async function execute(
  ctx: TenantContext,
  tx: Tx,
  messageId: string,
  command: ChannelCommand,
): Promise<ExecutionResult> {
  const message = await tx.inboundMessage.findFirst({ where: { id: messageId } });
  if (!message) throw new ValidationError('that inbound message does not exist');

  const identity = await tx.channelIdentity.findFirst({
    where: { channel: message.channel, externalId: message.fromAddress },
  });

  if (requiresVerifiedIdentity(command) && !(identity?.verified && identity.userId)) {
    await tx.inboundMessage.update({
      where: { id: messageId },
      data: { status: 'rejected', rejectedReason: 'unverified_sender', processedAt: new Date() },
    });
    metrics.increment('channel_inbound_rejected_total', { channel: message.channel, reason: 'unverified_sender' });
    return { outcome: 'refused', reason: 'the sender is not a verified identity' };
  }

  // From here the command acts as the mapped person, with `onBehalfOf` naming
  // the channel, so the audit trail says both who and how.
  // `onBehalfOf` is a user id, not a free-text note about how somebody acted —
  // it is a UUID column, and a channel name there fails the insert deep inside
  // the audit writer. The channel belongs in the display name and in the audit
  // payload, both of which are text.
  const actingCtx: TenantContext = {
    ...ctx,
    actor: {
      type: 'user',
      id: identity!.userId!,
      displayName: `${message.fromAddress} (via ${message.channel})`,
    },
  };

  if (command.kind === 'createTicket') {
    const ticket = await ticketService.createFromChannel(actingCtx, tx, {
      title: command.subject,
      description: command.body,
      requesterId: identity!.userId!,
      sourceChannel: message.channel,
      channelRef: message.externalMessageId,
    });
    await tx.inboundMessage.update({
      where: { id: messageId },
      data: { status: 'processed', ticketId: ticket.id, processedAt: new Date() },
    });
    await recordAudit(tx, actingCtx, {
      action: 'channel.ticket.created',
      targetType: 'ticket',
      targetId: ticket.id,
      after: { channel: message.channel, from: message.fromAddress, messageId: message.externalMessageId },
    });
    return { outcome: 'created', ticketNumber: ticket.number };
  }

  if (command.kind === 'addComment') {
    const ticket = await findTicketForReply(tx, command.ticketRef);
    if (!ticket) {
      // The thread it claimed to belong to is gone or never existed. A new
      // ticket is better than dropping what somebody wrote.
      const created = await ticketService.createFromChannel(actingCtx, tx, {
        title: message.subject?.trim() || '(no subject)',
        description: command.body,
        requesterId: identity!.userId!,
        sourceChannel: message.channel,
        channelRef: message.externalMessageId,
      });
      await tx.inboundMessage.update({
        where: { id: messageId },
        data: { status: 'processed', ticketId: created.id, processedAt: new Date() },
      });
      return { outcome: 'created', ticketNumber: created.number };
    }

    await ticketService.addCommentFromChannel(actingCtx, tx, ticket.id, {
      body: command.body,
      authorId: identity!.userId!,
      channel: message.channel,
    });
    await tx.inboundMessage.update({
      where: { id: messageId },
      data: { status: 'processed', ticketId: ticket.id, processedAt: new Date() },
    });
    return { outcome: 'commented', ticketNumber: ticket.number };
  }

  await tx.inboundMessage.update({
    where: { id: messageId },
    data: { status: 'processed', processedAt: new Date() },
  });
  return { outcome: 'refused', reason: `the ${command.kind} command is not available on this channel yet` };
}

async function findTicketForReply(tx: Tx, ticketRef: string) {
  if (/^[A-Z]{3}-\d{4,}$/i.test(ticketRef)) {
    return tx.ticket.findFirst({ where: { number: ticketRef.toUpperCase() } });
  }
  // A reference chain: find the conversation whose thread id we stamped.
  const ids = ticketRef.split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const conversation = await tx.conversation.findFirst({ where: { externalThreadId: id } });
    if (conversation?.ticketId) {
      const ticket = await tx.ticket.findFirst({ where: { id: conversation.ticketId } });
      if (ticket) return ticket;
    }
    const token = subjectToken(`[${id}]`);
    if (token) {
      const ticket = await tx.ticket.findFirst({ where: { number: token } });
      if (ticket) return ticket;
    }
  }
  return null;
}
