import { z } from 'zod';
import type { ChannelCommand } from './commands.js';

/**
 * Turning what somebody typed in chat into one of the six things a channel may
 * ask for.
 *
 * The command set stays closed (`commands.ts`), and nothing here widens it.
 * Chat offers three ways in and all three land in the same place:
 *
 *   - a **slash command**, where the person has said explicitly what they want;
 *   - a **message** — a mention or a direct message — where the intent has to be
 *     read from the words;
 *   - an **interactive action**, a button on a message the desk itself posted.
 *
 * The third is the one worth being careful about. A button payload carries
 * whatever value the message author put in it, and the message author is this
 * platform — but the payload comes back through the internet, so it is parsed
 * and validated exactly as strictly as free text, never trusted because "we
 * wrote it".
 */

/** `REQ-000123`, `INC-0042`: the shape `nextNumber` produces. */
const TICKET_REF = /\b([A-Z]{3}-\d{4,})\b/;

export function findTicketRef(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = TICKET_REF.exec(text.toUpperCase());
  return match ? match[1]! : null;
}

/**
 * Strips the leading mention so the first word of a request is the request.
 *
 * Slack sends `<@U123> my laptop is broken`; Teams sends `<at>Service Desk</at>
 * my laptop is broken`. Left in place, every ticket raised from chat would be
 * titled with the bot's own name.
 */
export function stripMention(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/gi, ' ')
    .replace(/<at>[^<]*<\/at>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SlashInput {
  /** The text after the command word, as the provider sends it. */
  text: string;
}

/**
 * `/ticket status REQ-000123`, `/ticket link 4821`, `/ticket my laptop died`.
 *
 * The bare form raises a ticket, because that is what somebody typing `/ticket`
 * most often means and making the common case the default is worth more than
 * symmetry. A subcommand is only recognised as one when what follows it fits:
 * `/ticket status of my laptop` is a request about a laptop, not a malformed
 * status query, and refusing it would be pedantry aimed at the wrong person.
 */
export function parseSlash(input: SlashInput): ChannelCommand {
  const text = input.text.trim();
  if (text === '') return { kind: 'handoff' };

  const [first = '', ...rest] = text.split(/\s+/);
  const word = first.toLowerCase();
  const remainder = rest.join(' ');

  if (word === 'status') {
    const ref = findTicketRef(remainder);
    if (ref) return { kind: 'getStatus', ticketRef: ref };
  }

  if (word === 'link') {
    const code = /^[A-Za-z0-9]{4,12}$/.test(remainder.trim()) ? remainder.trim() : undefined;
    return code ? { kind: 'linkIdentity', code } : { kind: 'linkIdentity' };
  }

  if (word === 'agent' || word === 'human' || word === 'help') {
    return { kind: 'handoff', reason: remainder.slice(0, 200) || undefined };
  }

  if (word === 'comment') {
    const ref = findTicketRef(remainder);
    if (ref) {
      const body = remainder.replace(new RegExp(ref, 'i'), '').trim();
      if (body) return { kind: 'addComment', ticketRef: ref, body };
    }
  }

  return { kind: 'createTicket', subject: titleFrom(text), body: text };
}

export interface MessageInput {
  text: string;
  /** A ticket already associated with this thread, when the desk started it. */
  threadTicketRef?: string | null;
}

/**
 * A mention or a direct message.
 *
 * A message in a thread the desk already opened is a comment on that ticket —
 * that is what a thread *is*, and asking people to repeat the reference would
 * be asking them to do the computer's filing.
 */
export function parseMessage(input: MessageInput): ChannelCommand {
  const text = stripMention(input.text);
  if (text === '') return { kind: 'handoff' };

  if (input.threadTicketRef) {
    return { kind: 'addComment', ticketRef: input.threadTicketRef, body: text };
  }

  const mentioned = findTicketRef(text);
  if (mentioned && /\b(status|update|where|how is|any news)\b/i.test(text)) {
    return { kind: 'getStatus', ticketRef: mentioned };
  }
  if (mentioned) return { kind: 'addComment', ticketRef: mentioned, body: text };

  return { kind: 'createTicket', subject: titleFrom(text), body: text };
}

/**
 * The payload behind a button.
 *
 * Validated as strictly as anything else that arrives over the internet. The
 * platform wrote the button, but what comes back is a request from outside, and
 * "we put that value there" is a statement about the past.
 */
export const actionPayloadSchema = z.object({
  action: z.enum(['approve', 'reject', 'status', 'custom']),
  /** The approval or ticket the button was about. */
  subjectId: z.string().uuid().optional(),
  ticketRef: z.string().max(40).optional(),
  /** For `custom`: which registered handler, and what it put in the button. */
  name: z.string().min(1).max(40).optional(),
  data: z.record(z.unknown()).optional(),
});

export function parseAction(raw: unknown): ChannelCommand | null {
  const parsed = actionPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;

  if (parsed.data.action === 'custom') {
    if (!parsed.data.name) return null;
    return { kind: 'custom', name: parsed.data.name, data: parsed.data.data ?? {} };
  }

  if (parsed.data.action === 'status') {
    const ref = findTicketRef(parsed.data.ticketRef ?? null);
    return ref ? { kind: 'getStatus', ticketRef: ref } : null;
  }

  if (!parsed.data.subjectId) return null;
  return {
    kind: 'decideApproval',
    approvalId: parsed.data.subjectId,
    decision: parsed.data.action === 'approve' ? 'approved' : 'rejected',
  };
}

/** A title somebody would recognise in a list: the first sentence, bounded. */
export function titleFrom(text: string): string {
  const firstLine = text.split('\n')[0]!.trim();
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0]!.trim() || firstLine;
  const candidate = sentence.length > 0 ? sentence : text.trim();
  return candidate.length > 120 ? `${candidate.slice(0, 117).trimEnd()}…` : candidate || '(no subject)';
}
