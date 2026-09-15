import { logger, metrics } from '@itsm/platform';
import type { EmailTransport, OutboundEmail, ProviderRef } from './email-transport.js';
import { constantTimeEquals, verifyHmac } from './email-transport.js';
import type { ParsedInbound } from './inbound-service.js';

/**
 * Postmark (OD-03, closed as "both, per tenant").
 *
 * The default adapter: fast to configure, good deliverability, and inbound
 * parsing that hands over a structured message rather than raw MIME the
 * platform would have to parse itself.
 *
 * Its one sharp edge is verification. Postmark does not sign inbound webhooks;
 * the documented protection is a secret in the webhook URL, over HTTPS. That is
 * weaker than a signature, so this adapter accepts *either* a URL secret or an
 * HMAC header a proxy has added, and refuses a delivery carrying neither —
 * rather than treating "no signature configured" as "verified", which is how an
 * open inbound endpoint gets shipped.
 */

export interface PostmarkOptions {
  /**
   * The resolved server token, not a reference.
   *
   * Resolution happens once in `transportForAccount`, so an adapter never
   * reaches for a credential store, never has to be async where the interface
   * is sync, and can be tested without one.
   */
  token: string;
  /** The resolved secret this tenant's webhook URL carries. */
  webhookSecret?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface PostmarkInbound {
  MessageID?: string;
  From?: string;
  FromFull?: { Email?: string };
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: { Name: string; Value: string }[];
  MailboxHash?: string;
}

export function postmarkTransport(options: PostmarkOptions): EmailTransport {
  const base = (options.apiBase ?? 'https://api.postmarkapp.com').replace(/\/+$/, '');
  const call = options.fetchImpl ?? fetch;

  return {
    name: 'postmark',

    async sendMessage(message: OutboundEmail): Promise<ProviderRef> {
      if (!options.token) throw new Error('Postmark is selected for this mailbox but its server token is not configured');

      const response = await call(`${base}/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'X-Postmark-Server-Token': options.token,
        },
        body: JSON.stringify({
          To: message.to,
          Subject: message.subject,
          TextBody: message.body,
          // The platform's own threading headers. Postmark passes unknown
          // headers through, which is what makes a reply thread back to the
          // ticket it came from.
          Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })),
          From: message.headers.From ?? undefined,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Postmark refused the message (${response.status}): ${detail.slice(0, 200)}`);
      }

      const body = (await response.json()) as { MessageID?: string };
      metrics.increment('channel_messages_sent_total', { transport: 'postmark' });
      return { messageId: message.headers['Message-ID'] ?? body.MessageID ?? '', providerId: body.MessageID ?? null };
    },

    parseInbound(body: unknown): ParsedInbound | null {
      const payload = body as PostmarkInbound;
      const from = payload.FromFull?.Email ?? payload.From;
      if (!from) return null;

      const headers: Record<string, string | undefined> = {};
      for (const header of payload.Headers ?? []) headers[header.Name.toLowerCase()] = header.Value;

      const text = payload.TextBody ?? stripHtml(payload.HtmlBody ?? '');
      return {
        channel: 'email',
        externalMessageId: payload.MessageID ?? headers['message-id'] ?? '',
        fromAddress: from.toLowerCase(),
        subject: payload.Subject ?? null,
        body: text || null,
        headers,
        sizeBytes: Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8'),
        raw: body,
      };
    },

    verify(rawBody: string, headers: Record<string, string | undefined>): boolean {
      const secret = options.webhookSecret;
      if (!secret) {
        // No secret configured means nothing to check, and accepting anyway
        // would make this endpoint an open door into the ticket system.
        logger.warn('a Postmark webhook arrived but no shared secret is configured; refusing it');
        return false;
      }

      // Either a signature a proxy added, or the secret the URL carries.
      const signature = headers['x-postmark-signature'] ?? headers['x-webhook-signature'];
      if (signature) return verifyHmac(rawBody, signature, secret);

      const presented = headers['x-webhook-secret'];
      if (!presented) return false;
      // Constant-time: `===` on a secret returns faster the sooner it differs.
      return constantTimeEquals(presented, secret);
    },
  };
}

/** Enough HTML stripping for a reply body; the ticket keeps the raw payload. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
