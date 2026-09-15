import type { RejectionReason } from './commands.js';

/**
 * Whether an inbound chat event should be acted on.
 *
 * The email guard reads RFC 3834 headers, which chat does not have. The shape
 * of the problem is the same and the signals are entirely different:
 *
 *   - **Our own bot.** The desk posts an acknowledgement, the bot's own message
 *     arrives back as an event, the desk acknowledges it. Same loop as a holiday
 *     responder, one turn faster, and it does not stop on its own.
 *   - **Somebody else's bot.** A deploy notifier in the channel is not raising a
 *     ticket. Ordinary rather than a fault, and counted separately so it does
 *     not read as one.
 *   - **Not addressed to us.** The desk gets invited to a busy channel and sees
 *     everything said in it. Only a mention or a direct message is a request.
 *     This is the commonest rejection by a wide margin, which is exactly why it
 *     needs its own counter rather than swelling `empty`.
 *   - **Edits, deletions, joins.** Events about a message rather than a message.
 *     Acting on an edit would re-raise a ticket somebody just corrected.
 */

export interface ChatEvent {
  /** The provider's id for whoever sent it. */
  senderId: string;
  text: string | null;
  /** Provider subtype: `message_changed`, `message_deleted`, `channel_join`. */
  subtype?: string | null;
  /** Set by the provider when the sender is an application rather than a person. */
  botId?: string | null;
  /** True for a direct message, where being addressed is implied. */
  direct: boolean;
  /** True when the desk's own bot was mentioned. */
  mentioned: boolean;
  sizeBytes: number;
}

export interface ChatGuardOptions {
  /** The bot user id this account posts as; a message from it is our own. */
  ownBotUserId: string | null;
  /** Other applications whose messages should still be read, by provider id. */
  allowedBotIds?: string[];
  maxBytes: number;
  recentFromSender: number;
  maxPerSenderPerHour: number;
  /**
   * The message is a reply in a thread the desk itself opened. Being in a
   * channel is not being spoken to; being in the desk's own thread is, which
   * is what lets "4" typed under a survey reach the survey without an @.
   */
  inKnownThread?: boolean;
}

export interface ChatGuardVerdict {
  accept: boolean;
  reason?: RejectionReason;
  detail?: string;
}

/** Subtypes that describe something happening to a message, not a message. */
const IGNORED_SUBTYPES = new Set([
  'message_changed',
  'message_deleted',
  'message_replied',
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'thread_broadcast',
  'bot_message',
]);

export function guardChat(event: ChatEvent, options: ChatGuardOptions): ChatGuardVerdict {
  // First, and before anything that could reply: our own voice coming back.
  if (options.ownBotUserId && event.senderId === options.ownBotUserId) {
    return { accept: false, reason: 'loop_detected', detail: 'the desk’s own message' };
  }

  if (event.botId) {
    const allowed = options.allowedBotIds ?? [];
    if (!allowed.includes(event.botId)) {
      return { accept: false, reason: 'bot_message', detail: event.botId };
    }
  }

  if (event.subtype && IGNORED_SUBTYPES.has(event.subtype)) {
    // `bot_message` as a subtype is caught here as well as by `botId`, because
    // providers are inconsistent about which they set.
    const reason: RejectionReason = event.subtype === 'bot_message' ? 'bot_message' : 'unsupported_event';
    return { accept: false, reason, detail: event.subtype };
  }

  if (event.sizeBytes > options.maxBytes) {
    return { accept: false, reason: 'too_large', detail: `${event.sizeBytes} bytes` };
  }

  if (!event.text?.trim()) return { accept: false, reason: 'empty' };

  // Being in a channel is not being spoken to. Being in the desk's own thread is.
  if (!event.direct && !event.mentioned && !options.inKnownThread) {
    return { accept: false, reason: 'not_addressed' };
  }

  if (options.recentFromSender >= options.maxPerSenderPerHour) {
    return { accept: false, reason: 'rate_limited', detail: `${options.recentFromSender} in the last hour` };
  }

  return { accept: true };
}
