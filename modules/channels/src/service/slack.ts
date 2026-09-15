import { call } from '@itsm/module-integrations';
import { type TenantContext, logger, resolveSecret } from '@itsm/platform';
import { verifySlackSignature } from '../domain/signatures.js';
import type { ChatTransport, OutboundChat, ParsedChat } from './chat-transport.js';

/**
 * Slack.
 *
 * Three inbound shapes, one outbound. The Events API posts messages; slash
 * commands arrive as form-encoded bodies; interactive components (a button on a
 * message the desk posted) arrive as a form field holding JSON. All three are
 * signed the same way, which is the only reason it is reasonable to accept
 * three shapes on one endpoint.
 *
 * Outbound goes through the MOD-14 gateway like every other outbound call
 * (ADR-0023). Slack's API host is public and stable, so the address guard is
 * not doing much here — but the credential handling, the circuit breaker and
 * the redacted log are, and a second way out of the platform is exactly what
 * that ADR exists to prevent.
 */

export interface SlackOptions {
  /** Credential holding the bot token, by name. Never the token. */
  botTokenRef: string;
  signingSecretRef: string;
  /** The bot's own user id, so the desk does not answer itself. */
  botUserId: string | null;
  apiBase?: string;
  ctx?: TenantContext | null;
}

const API_BASE = 'https://slack.com/api';

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Slack sends `<@U0DESK>` inside the text when the bot is mentioned, and also
 * lists it in `authorizations`. The text is the reliable one: a message in a
 * channel the bot is a member of carries the authorization whether or not
 * anybody spoke to it.
 */
function mentionsBot(text: string | null, botUserId: string | null): boolean {
  if (!text || !botUserId) return false;
  return text.includes(`<@${botUserId}>`);
}

export function slackTransport(options: SlackOptions): ChatTransport {
  const base = options.apiBase ?? API_BASE;

  return {
    name: 'slack',
    channel: 'slack',

    verify(input) {
      // Resolved synchronously from the environment; a missing secret is a
      // refusal rather than a pass, which is the only safe default here.
      const signingSecret = process.env[secretEnvName(options.signingSecretRef)];
      return verifySlackSignature({
        rawBody: input.rawBody,
        signature: input.headers['x-slack-signature'],
        timestamp: input.headers['x-slack-request-timestamp'],
        signingSecret,
      });
    },

    parseInbound(body): ParsedChat | null {
      const payload = body as Record<string, unknown>;

      // 1. Interactive component: a button on a message the desk posted.
      if (typeof payload.payload === 'string') {
        try {
          const interactive = JSON.parse(payload.payload) as Record<string, unknown>;
          return fromInteractive(interactive, options.botUserId);
        } catch {
          return null;
        }
      }

      // 2. Slash command: form-encoded, no `event` wrapper.
      if (typeof payload.command === 'string') {
        return fromSlash(payload, options.botUserId);
      }

      // 3. Events API.
      const event = payload.event as Record<string, unknown> | undefined;
      if (!event) return null;
      return fromEvent(event, payload, options.botUserId);
    },

    async send(message: OutboundChat) {
      const ctx = options.ctx ?? null;
      const token = await resolveSecret(ctx, options.botTokenRef);
      if (!token) {
        logger.warn('slack reply skipped: the bot token is not configured', { ref: options.botTokenRef });
        return { messageId: null };
      }

      const response = await call(ctx as TenantContext, {
        connector: 'slack',
        method: 'POST',
        url: `${base}/chat.postMessage`,
        credential: { header: 'authorization', value: `Bearer ${token}` },
        body: {
          channel: message.roomId,
          ...(message.threadId ? { thread_ts: message.threadId } : {}),
          text: message.text,
          ...(message.actions?.length
            ? {
                blocks: [
                  { type: 'section', text: { type: 'mrkdwn', text: message.text } },
                  {
                    type: 'actions',
                    elements: message.actions.map((action, index) => ({
                      type: 'button',
                      text: { type: 'plain_text', text: action.label },
                      // The value round-trips through Slack and comes back as
                      // untrusted input; it is parsed and validated on return,
                      // never trusted because the platform wrote it.
                      value: JSON.stringify(action.value),
                      action_id: `desk_action_${index}`,
                      ...(action.style ? { style: action.style } : {}),
                    })),
                  },
                ],
              }
            : {}),
        },
        cause: { kind: 'channel', id: 'slack' },
      });

      const result = response.body as { ok?: boolean; ts?: string; error?: string } | null;
      if (!result?.ok) {
        // Slack answers 200 with `ok: false`, so the HTTP status says nothing.
        logger.warn('slack rejected a reply', { error: result?.error ?? 'unknown' });
        return { messageId: null };
      }
      return { messageId: result.ts ?? null };
    },
  };
}

function secretEnvName(ref: string): string {
  return `ITSM_CREDENTIAL_${ref.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function shell(input: {
  externalMessageId: string;
  senderId: string;
  text: string | null;
  roomId: string;
  threadId: string | null;
  direct: boolean;
  mentioned: boolean;
  botId: string | null;
  subtype: string | null;
  raw: Record<string, unknown>;
  email?: string | null;
  displayName?: string | null;
}): ParsedChat {
  const text = input.text ?? '';
  return {
    channel: 'slack',
    externalMessageId: input.externalMessageId,
    fromAddress: input.senderId,
    subject: null,
    body: text,
    headers: {},
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    raw: input.raw,
    chat: {
      senderId: input.senderId,
      text: input.text,
      subtype: input.subtype,
      botId: input.botId,
      direct: input.direct,
      mentioned: input.mentioned,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
    },
    identity: {
      externalId: input.senderId,
      // Slack does not put the email on the event; it comes from `users.info`,
      // which the linking path fetches when it needs it. Absent here rather
      // than guessed.
      email: input.email ?? null,
      emailVerified: false,
      displayName: input.displayName ?? null,
    },
    threadId: input.threadId,
    roomId: input.roomId,
  };
}

function fromEvent(
  event: Record<string, unknown>,
  envelope: Record<string, unknown>,
  botUserId: string | null,
): ParsedChat | null {
  const senderId = textOf(event.user) ?? textOf(event.bot_id);
  const channelId = textOf(event.channel);
  const ts = textOf(event.ts);
  if (!senderId || !channelId || !ts) return null;

  const text = textOf(event.text);
  return shell({
    // `event_id` is unique per delivery and is what de-duplicates a retry;
    // Slack re-delivers on any non-2xx and on its own timeout.
    externalMessageId: textOf(envelope.event_id) ?? `${channelId}:${ts}`,
    senderId,
    text,
    roomId: channelId,
    // A reply goes to the thread if there is one, and starts one at this
    // message if there is not, so the conversation stays in one place.
    threadId: textOf(event.thread_ts) ?? ts,
    direct: textOf(event.channel_type) === 'im',
    mentioned: mentionsBot(text, botUserId),
    botId: textOf(event.bot_id),
    subtype: textOf(event.subtype),
    raw: { event, event_id: envelope.event_id },
  });
}

function fromSlash(payload: Record<string, unknown>, _botUserId: string | null): ParsedChat | null {
  const senderId = textOf(payload.user_id);
  const channelId = textOf(payload.channel_id);
  if (!senderId || !channelId) return null;

  const text = textOf(payload.text) ?? '';
  const parsed = shell({
    externalMessageId: `slash:${textOf(payload.trigger_id) ?? `${channelId}:${Date.now()}`}`,
    senderId,
    text,
    roomId: channelId,
    threadId: null,
    // Typing a slash command is addressing the desk, wherever it was typed.
    direct: true,
    mentioned: true,
    botId: null,
    subtype: null,
    raw: payload,
  });
  parsed.slashText = text;
  return parsed;
}

function fromInteractive(interactive: Record<string, unknown>, _botUserId: string | null): ParsedChat | null {
  const user = interactive.user as Record<string, unknown> | undefined;
  const container = interactive.container as Record<string, unknown> | undefined;
  const channel = interactive.channel as Record<string, unknown> | undefined;
  const actions = Array.isArray(interactive.actions) ? (interactive.actions as Record<string, unknown>[]) : [];
  const first = actions[0];

  const senderId = textOf(user?.id);
  const channelId = textOf(channel?.id) ?? textOf(container?.channel_id);
  if (!senderId || !channelId || !first) return null;

  let action: unknown = null;
  const value = textOf(first.value);
  if (value) {
    try {
      action = JSON.parse(value);
    } catch {
      // A value that is not JSON is a button from a version that did not write
      // one; refused rather than guessed at.
      return null;
    }
  }

  const parsed = shell({
    externalMessageId: `action:${textOf(interactive.trigger_id) ?? `${channelId}:${Date.now()}`}`,
    senderId,
    text: textOf(first.text as string) ?? 'action',
    roomId: channelId,
    threadId: textOf(container?.thread_ts) ?? textOf(container?.message_ts),
    direct: true,
    mentioned: true,
    botId: null,
    subtype: null,
    raw: interactive,
  });
  parsed.action = action;
  return parsed;
}
