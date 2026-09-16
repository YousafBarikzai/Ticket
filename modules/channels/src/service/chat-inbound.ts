import {
  type TenantContext,
  logger,
  metrics,
  newId,
  systemContext,
  transaction,
  withContext,
  type Tx,
} from '@itsm/platform';
import { canAutoLink, permits } from '../domain/identity-policy.js';
import { parseAction, parseMessage, parseSlash } from '../domain/chat-commands.js';
import type { ChannelCommand } from '../domain/commands.js';
import { acceptInbound, execute, resolveAccountTenant, type AcceptResult } from './inbound-service.js';
import { chatTransport, type OutboundChat, type ParsedChat } from './chat-transport.js';

/**
 * The chat inbound path, from a verified webhook to a reply.
 *
 * Everything security-relevant happened before this: the signature was checked
 * at the route, the guard dropped loops and messages that were not addressed to
 * the desk, and `acceptInbound` recorded the delivery idempotently. What is left
 * is deciding what was meant, deciding whether this person may mean it, doing
 * it, and saying so in the thread they are looking at.
 */

export interface ChatOutcome {
  status: AcceptResult['status'] | 'refused';
  reason?: string;
  ticketNumber?: string;
  /** What to post back, if anything. */
  reply?: string;
}

/** Works out the command from whichever of the three shapes arrived. */
export function commandFor(parsed: ParsedChat, threadTicketRef: string | null): ChannelCommand | null {
  if (parsed.action !== undefined) return parseAction(parsed.action);
  if (parsed.slashText !== undefined) return parseSlash({ text: parsed.slashText });
  return parseMessage({ text: parsed.body ?? '', threadTicketRef });
}

/**
 * Links a chat account to a person on the provider's word, where the tenant has
 * said that word is good enough.
 *
 * Only ever *creates* a link, and only one the policy will treat as weak. It
 * cannot upgrade an existing identity: an address already verified by code must
 * not be quietly downgraded, and one already linked to somebody else must not be
 * repointed by a profile edit.
 */
export async function autoLinkIfAllowed(
  ctx: TenantContext,
  tx: Parameters<typeof execute>[1],
  parsed: ParsedChat,
  accountId: string,
  trustedDomains: string[],
): Promise<void> {
  if (!canAutoLink({ email: parsed.identity.email, providerVerified: parsed.identity.emailVerified, trustedDomains })) {
    return;
  }

  const existing = await tx.channelIdentity.findFirst({
    where: { channel: parsed.channel, externalId: parsed.identity.externalId },
  });
  if (existing) return;

  const user = await tx.user.findFirst({
    where: { email: parsed.identity.email!.toLowerCase() },
    select: { id: true },
  });
  if (!user) return;

  await tx.channelIdentity.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      accountId,
      channel: parsed.channel,
      externalId: parsed.identity.externalId,
      userId: user.id,
      verified: true,
      verifiedAt: new Date(),
      method: 'provider_verified',
    },
  });
  metrics.increment('channel_identity_auto_linked_total', { channel: parsed.channel });
}

/**
 * Handles one verified chat delivery.
 *
 * The reply is part of the outcome rather than a side effect, so a caller that
 * wants to answer synchronously — a slash command, where the person is waiting
 * — can, and one that does not can post it later.
 */
/**
 * Actions other modules own.
 *
 * A survey's rating buttons belong to MOD-18, and MOD-18 depends on this
 * module, so this module cannot import the handler: it is registered at
 * import time under a name, and a button carrying `{ action: 'custom', name }`
 * finds it. The handler decides who may answer — only it knows what the
 * answer means — and receives the sender's linked identity to decide with.
 */
export interface ChatActionContext {
  ctx: TenantContext;
  tx: Tx;
  parsed: ParsedChat;
  /** The sender's linked platform identity, if they have one here. */
  identity: { userId: string | null; verified: boolean } | null;
  conversation: { id: string; ticketId: string | null } | null;
}

export interface ChatActionHandler {
  /** A button press carrying this handler's name. */
  onAction(data: Record<string, unknown>, context: ChatActionContext): Promise<{ reply: string }>;
  /**
   * A plain reply while the conversation is waiting on this handler — a "4"
   * typed instead of clicked. Return null to say the text was not an answer,
   * and it falls through to the ordinary commands.
   */
  onText?(text: string, data: Record<string, unknown>, context: ChatActionContext): Promise<{ reply: string } | null>;
}

const chatActions = new Map<string, ChatActionHandler>();

export function registerChatAction(name: string, handler: ChatActionHandler): void {
  chatActions.set(name, handler);
}

export function chatAction(name: string): ChatActionHandler | undefined {
  return chatActions.get(name);
}

/** What a conversation is waiting for, kept in its state. */
export interface Awaiting {
  action: string;
  data: Record<string, unknown>;
  expiresAt: string;
}

function awaitingOf(state: unknown): Awaiting | null {
  const awaiting = (state as { awaiting?: Awaiting } | null)?.awaiting;
  if (!awaiting || typeof awaiting.action !== 'string') return null;
  if (new Date(awaiting.expiresAt) <= new Date()) return null;
  return awaiting;
}

export async function handleChat(parsed: ParsedChat, accountKey: string): Promise<ChatOutcome> {
  const account = await resolveAccountTenant(parsed.channel, accountKey);
  if (!account) return { status: 'rejected', reason: 'unknown_account' };

  const accepted = await acceptInbound(parsed, accountKey);
  if (accepted.status !== 'accepted' || !accepted.messageId) {
    return { status: accepted.status, reason: accepted.reason };
  }

  const ctx = systemContext(account.tenantId, {
    actor: { type: 'channel', id: null, displayName: parsed.channel },
  });

  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const accountRow = await tx.channelAccount.findFirst({ where: { id: account.accountId } });
      const config = (accountRow?.config ?? {}) as { trustedEmailDomains?: string[] };

      await autoLinkIfAllowed(ctx, tx, parsed, account.accountId, config.trustedEmailDomains ?? []);

      // A conversation the desk already opened tells us which ticket a reply
      // belongs to, which is what makes a thread work as a thread.
      const conversation = parsed.threadId
        ? await tx.conversation.findFirst({ where: { channel: parsed.channel, externalThreadId: parsed.threadId } })
        : null;
      const threadTicket = conversation?.ticketId
        ? await tx.ticket.findFirst({ where: { id: conversation.ticketId }, select: { number: true } })
        : null;

      const identity = await tx.channelIdentity.findFirst({
        where: { channel: parsed.channel, externalId: parsed.identity.externalId },
      });
      const actionContext: ChatActionContext = {
        ctx,
        tx,
        parsed,
        identity: identity ? { userId: identity.userId, verified: identity.verified } : null,
        conversation: conversation ? { id: conversation.id, ticketId: conversation.ticketId } : null,
      };

      // A button that belongs to another module, or a typed reply to a
      // question one of them asked in this thread.
      const command = commandFor(parsed, threadTicket?.number ?? null);
      const custom = command?.kind === 'custom' ? command : null;
      if (custom) {
        const handler = chatAction(custom.name);
        if (!handler) {
          return { status: 'refused' as const, reason: 'unrecognised', reply: 'That button no longer does anything.' };
        }
        const result = await handler.onAction(custom.data, actionContext);
        await tx.inboundMessage.update({ where: { id: accepted.messageId! }, data: { processedAt: new Date() } });
        return { status: 'accepted' as const, reply: result.reply };
      }

      const awaiting = conversation ? awaitingOf(conversation.state) : null;
      if (awaiting && parsed.action === undefined && parsed.slashText === undefined) {
        const handler = chatAction(awaiting.action);
        const result = handler?.onText ? await handler.onText(parsed.body ?? '', awaiting.data, actionContext) : null;
        if (result) {
          await tx.conversation.update({
            where: { id: conversation!.id },
            data: { state: { ...(conversation!.state as object), awaiting: null } as never, lastInboundAt: new Date() },
          });
          await tx.inboundMessage.update({ where: { id: accepted.messageId! }, data: { processedAt: new Date() } });
          return { status: 'accepted' as const, reply: result.reply };
        }
      }

      if (!command) {
        return { status: 'refused' as const, reason: 'unrecognised', reply: 'I did not understand that.' };
      }

      const verdict = permits(
        identity ? { userId: identity.userId, verified: identity.verified, method: identity.method } : null,
        command,
      );
      if (!verdict.allowed) {
        await tx.inboundMessage.update({
          where: { id: accepted.messageId! },
          data: { status: 'rejected', rejectedReason: 'unverified_sender', processedAt: new Date() },
        });
        metrics.increment('channel_inbound_rejected_total', {
          channel: parsed.channel,
          reason: 'unverified_sender',
        });
        // The reply is the only thing the person sees, so it says what to do
        // next rather than that they are not allowed.
        return { status: 'refused' as const, reason: 'unverified_sender', reply: verdict.message };
      }

      const result = await execute(ctx, tx, accepted.messageId!, command);

      if (result.ticketNumber) {
        await rememberConversation(tx, ctx, parsed, account.accountId, result.ticketNumber);
      }

      return {
        status: 'accepted' as const,
        ...(result.ticketNumber ? { ticketNumber: result.ticketNumber } : {}),
        reply: replyFor(result.outcome, result.ticketNumber, result.reason),
      };
    }),
  ).catch((error: unknown) => {
    logger.warn('a chat delivery could not be handled', {
      channel: parsed.channel,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'refused' as const, reason: 'error' };
  });
}

/**
 * Remembers which thread a ticket lives in, so an update can be posted where
 * the person is already looking rather than by email.
 */
async function rememberConversation(
  tx: Parameters<typeof execute>[1],
  ctx: TenantContext,
  parsed: ParsedChat,
  accountId: string,
  ticketNumber: string,
): Promise<void> {
  if (!parsed.threadId) return;
  const ticket = await tx.ticket.findFirst({ where: { number: ticketNumber }, select: { id: true } });
  if (!ticket) return;

  const existing = await tx.conversation.findFirst({
    where: { channel: parsed.channel, externalThreadId: parsed.threadId },
  });
  if (existing) {
    await tx.conversation.update({ where: { id: existing.id }, data: { lastInboundAt: new Date() } });
    return;
  }

  await tx.conversation.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      accountId,
      channel: parsed.channel,
      ticketId: ticket.id,
      externalThreadId: parsed.threadId,
      state: { roomId: parsed.roomId } as never,
      lastInboundAt: new Date(),
    },
  });
}

function replyFor(outcome: string, ticketNumber?: string, reason?: string): string {
  if (outcome === 'created' && ticketNumber) return `Raised ${ticketNumber}. I will post updates here.`;
  if (outcome === 'commented' && ticketNumber) return `Added that to ${ticketNumber}.`;
  return reason ?? 'I could not do that.';
}

/** Posts a reply through whichever transport this account uses. */
export async function replyToChat(
  transportName: string,
  message: { roomId: string; threadId: string | null; text: string },
): Promise<void> {
  const transport = chatTransport(transportName);
  if (!transport) {
    logger.warn('no chat transport is registered for a reply', { transport: transportName });
    return;
  }
  await transport.send(message);
}

/**
 * Posts into the chat thread a ticket lives in, if it lives in one.
 *
 * For a module that wants to ask the requester something where they already
 * are — a survey after resolution — without knowing which provider that is.
 * Returns what it did, so the caller can fall back to email when there is no
 * thread. `awaiting` marks the conversation as waiting on the named handler,
 * so a typed reply reaches it as well as a button.
 */
export async function postToTicketThread(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  message: { text: string; actions?: OutboundChat['actions'] },
  awaiting?: Awaiting,
): Promise<{ posted: boolean; conversationId: string | null; channel: string | null; supportsButtons: boolean }> {
  const conversation = await tx.conversation.findFirst({
    where: { ticketId, channel: { in: ['slack', 'teams', 'whatsapp'] } },
    orderBy: { lastInboundAt: 'desc' },
  });
  if (!conversation) return { posted: false, conversationId: null, channel: null, supportsButtons: false };

  const account = await tx.channelAccount.findFirst({ where: { id: conversation.accountId } });
  const config = (account?.config ?? {}) as { transport?: string };
  const transport = chatTransport(config.transport ?? conversation.channel);
  if (!transport) {
    logger.warn('a ticket has a chat thread but no transport to post into it', { ticketId, channel: conversation.channel });
    return { posted: false, conversationId: conversation.id, channel: conversation.channel, supportsButtons: false };
  }

  const state = (conversation.state ?? {}) as { roomId?: string };
  const roomId = state.roomId ?? conversation.externalThreadId;
  if (!roomId) return { posted: false, conversationId: conversation.id, channel: conversation.channel, supportsButtons: false };

  // WhatsApp carries text and nothing else; a rating there is a number typed
  // in reply, which `awaiting` is for.
  const supportsButtons = conversation.channel !== 'whatsapp';
  await transport.send({
    roomId,
    threadId: conversation.externalThreadId,
    text: message.text,
    ...(supportsButtons && message.actions?.length ? { actions: message.actions } : {}),
  });

  await tx.conversation.update({
    where: { id: conversation.id },
    data: {
      lastOutboundAt: new Date(),
      ...(awaiting ? { state: { ...(conversation.state as object), awaiting } as never } : {}),
    },
  });
  return { posted: true, conversationId: conversation.id, channel: conversation.channel, supportsButtons };
}
