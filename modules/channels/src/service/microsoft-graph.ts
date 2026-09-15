import { logger, metrics } from '@itsm/platform';
import { constantTimeEquals, type EmailTransport, type OutboundEmail, type ProviderRef } from './email-transport.js';
import type { ParsedInbound } from './inbound-service.js';
import { clientCredentialsToken } from './aad-token.js';

/**
 * Microsoft Graph (OD-03, closed as "both, per tenant").
 *
 * The adapter for tenants whose DPIA will not accept mail being processed
 * outside their own Microsoft geography: with Graph, the mailbox stays where
 * Microsoft already keeps it and the platform reads it rather than receiving a
 * copy. That is the whole reason this adapter exists, and it is why the choice
 * is per tenant rather than per deployment — one customer's data-residency
 * commitment should not decide another's mail provider.
 *
 * Graph is harder in three ways, all of them handled here so the inbound path
 * does not have to know:
 *
 *   - **Tokens expire.** A client-credentials token lasts about an hour, so it
 *     is fetched on demand and cached until shortly before it expires.
 *   - **Notifications are not the message.** Graph sends "something changed in
 *     this mailbox", not the mail; the message is then read back by id.
 *   - **Subscriptions expire too**, in days rather than hours, and a lapsed one
 *     fails silently — mail simply stops arriving, with nothing in the logs.
 *     `renewSubscription` exists for the job that keeps them alive.
 */

export interface GraphOptions {
  tenantId: string;
  clientId: string;
  /** The resolved client secret. Resolution happens in `transportForAccount`. */
  clientSecret: string;
  /** The mailbox this account receives on, as a Graph user id or UPN. */
  mailbox: string;
  /**
   * The value Graph echoes back on every notification. It is the
   * only thing that distinguishes a real notification from anyone who guesses
   * the URL, because Graph does not sign these.
   */
  clientState: string;
  apiBase?: string;
  loginBase?: string;
  fetchImpl?: typeof fetch;
}

interface GraphNotification {
  value?: {
    subscriptionId?: string;
    clientState?: string;
    resource?: string;
    resourceData?: { id?: string };
  }[];
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export function microsoftGraphTransport(options: GraphOptions): EmailTransport {
  const api = (options.apiBase ?? 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
  const login = (options.loginBase ?? 'https://login.microsoftonline.com').replace(/\/+$/, '');
  const call = options.fetchImpl ?? fetch;

  const token = clientCredentialsToken({
    loginBase: login,
    directory: options.tenantId,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  return {
    name: 'microsoft-graph',

    async sendMessage(message: OutboundEmail): Promise<ProviderRef> {
      const accessToken = await token();
      const response = await call(`${api}/users/${encodeURIComponent(options.mailbox)}/sendMail`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: 'Text', content: message.body },
            toRecipients: [{ emailAddress: { address: message.to } }],
            // Graph rejects most standard headers as reserved; only `x-`
            // headers get through, so the platform's threading token travels as
            // one. `resolveThread` already reads a header token first, which is
            // what makes this work without a second threading scheme.
            internetMessageHeaders: Object.entries(message.headers)
              .filter(([name]) => name.toLowerCase().startsWith('x-'))
              .slice(0, 5)
              .map(([name, value]) => ({ name, value })),
          },
          saveToSentItems: true,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Graph refused the message (${response.status}): ${detail.slice(0, 200)}`);
      }

      metrics.increment('channel_messages_sent_total', { transport: 'microsoft-graph' });
      // sendMail returns 202 with no body, so the platform's own Message-ID is
      // the only id there is until the message appears in Sent Items.
      return { messageId: message.headers['Message-ID'] ?? '', providerId: null };
    },

    /**
     * Graph notifications carry no message, so this returns what the poller
     * needs to fetch it rather than a finished `ParsedInbound`.
     *
     * Returning null here is correct rather than a failure: the inbound path
     * treats a notification as "go and read the mailbox", and `fetchMessage`
     * below produces the real message.
     */
    parseInbound(body: unknown): ParsedInbound | null {
      const payload = body as GraphNotification;
      const first = payload.value?.[0];
      if (!first?.resourceData?.id) return null;

      // A marker the caller recognises: the id to fetch, and nothing else,
      // because a notification genuinely contains nothing else.
      return {
        channel: 'email',
        externalMessageId: first.resourceData.id,
        fromAddress: '',
        subject: null,
        body: null,
        headers: { 'x-graph-resource': first.resource ?? '' },
        sizeBytes: 0,
        raw: body,
      };
    },

    /**
     * Graph does not sign notifications. What it does is echo back the
     * `clientState` the subscription was created with, and that is the whole of
     * the verification available — so it is compared in constant time, and a
     * notification without it is refused rather than trusted.
     */
    verify(rawBody: string): boolean {
      const expected = options.clientState;
      if (!expected) {
        logger.warn('a Graph notification arrived but no clientState is configured; refusing it');
        return false;
      }

      let payload: GraphNotification;
      try {
        payload = JSON.parse(rawBody) as GraphNotification;
      } catch {
        return false;
      }

      const states = (payload.value ?? []).map((entry) => entry.clientState);
      if (states.length === 0) return false;
      // Every notification in the batch must match: one that does not is
      // somebody else's, and accepting the batch would accept theirs too.
      return states.every((state) => typeof state === 'string' && constantTimeEquals(state, expected));
    },
  };
}

/**
 * Reads the message a notification pointed at.
 *
 * Separate from the transport interface because only Graph needs it: every
 * other provider delivers the message itself. Exported so the inbound route can
 * complete the two-step, and so it can be tested without a mailbox.
 */
export async function fetchGraphMessage(
  options: GraphOptions,
  messageId: string,
  accessToken: string,
): Promise<ParsedInbound | null> {
  const api = (options.apiBase ?? 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
  const call = options.fetchImpl ?? fetch;

  const response = await call(
    `${api}/users/${encodeURIComponent(options.mailbox)}/messages/${encodeURIComponent(messageId)}?$select=id,subject,body,from,internetMessageId,internetMessageHeaders`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    logger.warn('Graph would not return a notified message', { messageId, status: response.status });
    return null;
  }

  const message = (await response.json()) as {
    id: string;
    subject?: string;
    body?: { content?: string; contentType?: string };
    from?: { emailAddress?: { address?: string } };
    internetMessageId?: string;
    internetMessageHeaders?: { name: string; value: string }[];
  };

  const from = message.from?.emailAddress?.address;
  if (!from) return null;

  const headers: Record<string, string | undefined> = {};
  for (const header of message.internetMessageHeaders ?? []) headers[header.name.toLowerCase()] = header.value;
  if (message.internetMessageId) headers['message-id'] = message.internetMessageId;

  return {
    channel: 'email',
    externalMessageId: message.internetMessageId ?? message.id,
    fromAddress: from.toLowerCase(),
    subject: message.subject ?? null,
    body: message.body?.content ?? null,
    headers,
    sizeBytes: Buffer.byteLength(message.body?.content ?? '', 'utf8'),
    raw: message,
  };
}

/**
 * Extends a mailbox subscription.
 *
 * Graph subscriptions expire in about three days and a lapsed one fails
 * silently: mail stops arriving and nothing is logged, because from Graph's
 * point of view nothing went wrong. A renewal job is not an optimisation.
 */
export async function renewGraphSubscription(
  options: GraphOptions,
  subscriptionId: string,
  accessToken: string,
  days = 2,
): Promise<Date | null> {
  const api = (options.apiBase ?? 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
  const call = options.fetchImpl ?? fetch;
  const expiry = new Date(Date.now() + days * 86_400_000);

  const response = await call(`${api}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ expirationDateTime: expiry.toISOString() }),
  });

  if (!response.ok) {
    logger.warn('Graph would not renew a mailbox subscription', { subscriptionId, status: response.status });
    return null;
  }
  return expiry;
}
