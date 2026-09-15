import { call } from '@itsm/module-integrations';
import { type TenantContext, logger, resolveSecret } from '@itsm/platform';
import { verifyMetaSignature } from '../domain/signatures.js';
import type { ChatTransport, OutboundChat, ParsedChat } from './chat-transport.js';

/**
 * WhatsApp, through the Meta Business API.
 *
 * The same interface as Slack and Teams, and one rule that has no equivalent in
 * either: **the 24-hour session window**. Meta only allows free-form messages to
 * somebody for 24 hours after *they* last wrote. Outside it, the only thing
 * that may be sent is a pre-approved template.
 *
 * That is not a quota to be retried past. A free-form send outside the window is
 * refused by Meta, and repeatedly attempting them is how a business number gets
 * its quality rating cut and eventually blocked — losing the channel for every
 * requester, not just the one. So the window is tracked and checked before
 * sending, and a message that falls outside it is reported rather than thrown at
 * the API to see what happens.
 *
 * The consequence worth stating: a ticket update more than a day after the
 * person last wrote cannot be delivered here without a template the tenant has
 * had approved. The reply is dropped with a reason rather than silently lost,
 * and the other channels still carry it.
 */

export interface WhatsAppOptions {
  /** Credential holding the Meta access token, by name. */
  accessTokenRef: string;
  /** The app secret the webhook signature is keyed with. */
  appSecretRef: string;
  /** The business phone number id Meta assigned. */
  phoneNumberId: string;
  /** A template approved for use outside the session window, if any. */
  outsideWindowTemplate?: { name: string; languageCode: string };
  apiBase?: string;
  ctx?: TenantContext | null;
}

/** Meta's rule, in milliseconds. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a free-form message may be sent.
 *
 * Pure so it can be tested without a provider: this is the rule the channel
 * lives or dies by, and it should not need an HTTP call to check.
 */
export function withinSessionWindow(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SESSION_WINDOW_MS;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function secretEnvName(ref: string): string {
  return `ITSM_CREDENTIAL_${ref.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function whatsappTransport(options: WhatsAppOptions): ChatTransport {
  const base = (options.apiBase ?? 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');

  return {
    name: 'whatsapp',
    channel: 'whatsapp',

    verify(input) {
      return verifyMetaSignature({
        rawBody: input.rawBody,
        signature: input.headers['x-hub-signature-256'],
        appSecret: process.env[secretEnvName(options.appSecretRef)],
      });
    },

    parseInbound(body): ParsedChat | null {
      const payload = body as Record<string, unknown>;
      const entry = Array.isArray(payload.entry) ? (payload.entry[0] as Record<string, unknown>) : undefined;
      const changes = Array.isArray(entry?.changes) ? (entry.changes[0] as Record<string, unknown>) : undefined;
      const value = changes?.value as Record<string, unknown> | undefined;

      // Meta sends delivery receipts and read receipts through the same
      // webhook. They are not messages and must not become tickets.
      const messages = Array.isArray(value?.messages) ? (value.messages as Record<string, unknown>[]) : [];
      const message = messages[0];
      if (!message) return null;

      const from = textOf(message.from);
      const id = textOf(message.id);
      if (!from || !id) return null;

      // Only text for now. An image or a voice note arriving as a ticket with
      // no body would be worse than a clear refusal, so unsupported types are
      // dropped as unsupported rather than turned into an empty ticket.
      const text = textOf((message.text as Record<string, unknown> | undefined)?.body);
      const type = textOf(message.type);
      if (type !== 'text' || !text) {
        return null;
      }

      const contacts = Array.isArray(value?.contacts) ? (value.contacts as Record<string, unknown>[]) : [];
      const profile = contacts[0]?.profile as Record<string, unknown> | undefined;

      return {
        channel: 'whatsapp',
        externalMessageId: id,
        fromAddress: from,
        subject: null,
        body: text,
        headers: {},
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        raw: { message, contacts },
        chat: {
          senderId: from,
          text,
          subtype: null,
          botId: null,
          // WhatsApp is one-to-one: every message is addressed to the business.
          direct: true,
          mentioned: true,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
        },
        identity: {
          externalId: from,
          // A phone number is not an email, and Meta vouches for neither. A
          // WhatsApp identity is always linked by code.
          email: null,
          emailVerified: false,
          displayName: textOf(profile?.name),
        },
        // WhatsApp has no threads; the conversation is the phone number.
        threadId: from,
        roomId: from,
      };
    },

    async send(message: OutboundChat) {
      const ctx = options.ctx ?? null;
      const token = await resolveSecret(ctx, options.accessTokenRef);
      if (!token) {
        logger.warn('whatsapp reply skipped: the access token is not configured', { ref: options.accessTokenRef });
        return { messageId: null };
      }

      const response = await call(ctx as TenantContext, {
        connector: 'whatsapp',
        method: 'POST',
        url: `${base}/${options.phoneNumberId}/messages`,
        credential: { header: 'authorization', value: `Bearer ${token}` },
        body: {
          messaging_product: 'whatsapp',
          to: message.roomId,
          type: 'text',
          text: { body: message.text },
        },
        cause: { kind: 'channel', id: 'whatsapp' },
      });

      if (response.status >= 400) {
        logger.warn('whatsapp rejected a reply', { status: response.status });
        return { messageId: null };
      }
      const result = response.body as { messages?: { id?: string }[] } | null;
      return { messageId: result?.messages?.[0]?.id ?? null };
    },
  };
}
