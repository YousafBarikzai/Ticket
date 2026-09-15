import { logger } from '@itsm/platform';
import { verifyTeamsSignature } from '../domain/signatures.js';
import { clientCredentialsToken } from './aad-token.js';
import type { ChatTransport, OutboundChat, ParsedChat } from './chat-transport.js';

/**
 * Microsoft Teams.
 *
 * Teams offers two integration shapes and this is the simpler one: an **outgoing
 * webhook**, authenticated by a shared HMAC secret. The alternative is a
 * registered Bot Framework bot, whose inbound activities carry an Azure AD JWT
 * that has to be validated against Microsoft's published keys.
 *
 * The choice is deliberate and worth stating, because the richer option is the
 * one an ITSM product eventually wants. A JWT validated against JWKS needs key
 * rotation, issuer and audience checks and clock-skew handling — all of which
 * the platform already does correctly for Keycloak in `apps/api/src/auth`, and
 * none of which is reachable from a module without either duplicating it or
 * inverting a dependency. Doing that badly here would be worse than doing the
 * HMAC form well: an outgoing webhook is a real integration that real service
 * desks use, and the bot path can be added behind this same interface without
 * changing anything downstream.
 *
 * What the HMAC form costs, and it is a real cost: there is no timestamp in the
 * scheme, so a captured request can be replayed. Message de-duplication upstream
 * is what bounds that, which is why it is load-bearing here rather than tidy.
 */

export interface TeamsOptions {
  /** The shared secret Teams issued, base64, by credential name. */
  secretRef: string;
  /** For replying: the bot's AAD application. */
  clientId?: string;
  clientSecretRef?: string;
  /** Where Teams said to reply. Captured from the inbound activity. */
  serviceUrl?: string;
  loginBase?: string;
  fetchImpl?: typeof fetch;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function secretEnvName(ref: string): string {
  return `ITSM_CREDENTIAL_${ref.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function teamsTransport(options: TeamsOptions): ChatTransport {
  const token = options.clientId
    ? clientCredentialsToken({
        loginBase: options.loginBase ?? 'https://login.microsoftonline.com',
        // A multi-tenant Teams bot authenticates against this directory rather
        // than against the customer's, which is the detail that sends people
        // round in circles when a token is refused.
        directory: 'botframework.com',
        clientId: options.clientId,
        clientSecret: options.clientSecretRef ? process.env[secretEnvName(options.clientSecretRef)] : undefined,
        scope: 'https://api.botframework.com/.default',
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    : null;

  return {
    name: 'teams',
    channel: 'teams',

    verify(input) {
      return verifyTeamsSignature({
        rawBody: input.rawBody,
        authorization: input.headers.authorization,
        secretBase64: process.env[secretEnvName(options.secretRef)],
      });
    },

    parseInbound(body): ParsedChat | null {
      const activity = body as Record<string, unknown>;
      const type = textOf(activity.type);
      if (!type) return null;

      const from = activity.from as Record<string, unknown> | undefined;
      const conversation = activity.conversation as Record<string, unknown> | undefined;
      // The AAD object id is the stable identifier for a person; `from.id` is
      // per-bot and changes if the bot is reinstalled.
      const senderId = textOf(from?.aadObjectId) ?? textOf(from?.id);
      const roomId = textOf(conversation?.id);
      const activityId = textOf(activity.id);
      if (!senderId || !roomId || !activityId) return null;

      const conversationType = textOf(conversation?.conversationType);
      const direct = conversationType === 'personal';
      const text = textOf(activity.text);

      const parsed: ParsedChat = {
        channel: 'teams',
        externalMessageId: activityId,
        fromAddress: senderId,
        subject: null,
        body: text ?? '',
        headers: {},
        sizeBytes: Buffer.byteLength(text ?? '', 'utf8'),
        raw: activity,
        chat: {
          senderId,
          text,
          subtype: type === 'message' ? null : type,
          botId: null,
          direct,
          // An outgoing webhook only fires when the bot is mentioned, so a
          // channel activity that reached us was addressed to us.
          mentioned: true,
          sizeBytes: Buffer.byteLength(text ?? '', 'utf8'),
        },
        identity: {
          externalId: senderId,
          email: textOf(from?.userPrincipalName) ?? textOf((from as { email?: string } | undefined)?.email),
          // Teams reports the principal name from the directory, which the
          // directory verified. The tenant still has to claim the domain before
          // that means anything here (see `canAutoLink`).
          emailVerified: Boolean(textOf(from?.aadObjectId)),
          displayName: textOf(from?.name),
        },
        // Teams threads by the root activity; `replyToId` names it when this is
        // itself a reply.
        threadId: textOf(activity.replyToId) ?? activityId,
        roomId,
      };

      // An Adaptive Card button comes back as an invoke with the card's own
      // data, which is whatever the desk put on the card and is re-validated.
      if (type === 'invoke') {
        const value = activity.value as Record<string, unknown> | undefined;
        const action = value?.action as Record<string, unknown> | undefined;
        parsed.action = action?.data ?? value?.data ?? null;
      }

      return parsed;
    },

    async send(message: OutboundChat) {
      const serviceUrl = options.serviceUrl?.replace(/\/+$/, '');
      if (!serviceUrl || !token) {
        logger.warn('teams reply skipped: no service url or bot credentials are configured');
        return { messageId: null };
      }

      const call = options.fetchImpl ?? fetch;
      const accessToken = await token();
      const response = await call(`${serviceUrl}/v3/conversations/${encodeURIComponent(message.roomId)}/activities`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          ...(message.threadId ? { replyToId: message.threadId } : {}),
          text: message.text,
          ...(message.actions?.length
            ? {
                attachments: [
                  {
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    content: {
                      type: 'AdaptiveCard',
                      version: '1.4',
                      body: [{ type: 'TextBlock', text: message.text, wrap: true }],
                      actions: message.actions.map((action) => ({
                        type: 'Action.Execute',
                        title: action.label,
                        data: action.value,
                      })),
                    },
                  },
                ],
              }
            : {}),
        }),
      });

      if (!response.ok) {
        logger.warn('teams rejected a reply', { status: response.status });
        return { messageId: null };
      }
      const result = (await response.json().catch(() => null)) as { id?: string } | null;
      return { messageId: result?.id ?? null };
    },
  };
}
