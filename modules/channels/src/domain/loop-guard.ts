import type { RejectionReason } from './commands.js';

/**
 * Whether an inbound message should be dropped before anything acts on it
 * (docs/architecture/07 §5, "loop and abuse protection").
 *
 * The case this exists for: someone sets an out-of-office responder, the service
 * desk acknowledges their ticket, the responder replies to the acknowledgement,
 * the desk acknowledges the reply. Left alone that runs until the mailbox fills.
 * The headers below are the ones every mail system sets to say "this was sent by
 * a machine", and honouring them is how the loop stops at one message.
 */

export interface InboundCandidate {
  headers: Record<string, string | undefined>;
  subject: string | null;
  body: string | null;
  fromAddress: string;
  sizeBytes: number;
}

export interface GuardOptions {
  maxBytes: number;
  /** The addresses this platform sends from; a message from one is our own. */
  ownAddresses: string[];
  /** Messages accepted from this sender in the rate window. */
  recentFromSender: number;
  maxPerSenderPerHour: number;
}

export interface GuardVerdict {
  accept: boolean;
  reason?: RejectionReason;
  detail?: string;
}

const AUTO_SUBMITTED_OK = new Set(['no', '']);

export function guardInbound(message: InboundCandidate, options: GuardOptions): GuardVerdict {
  const headers = lowerKeys(message.headers);

  if (message.sizeBytes > options.maxBytes) {
    return { accept: false, reason: 'too_large', detail: `${message.sizeBytes} bytes` };
  }

  if (!message.subject?.trim() && !message.body?.trim()) {
    return { accept: false, reason: 'empty' };
  }

  // RFC 3834: anything but `auto-submitted: no` was generated automatically.
  const autoSubmitted = (headers['auto-submitted'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!AUTO_SUBMITTED_OK.has(autoSubmitted)) {
    return { accept: false, reason: 'auto_reply', detail: `auto-submitted: ${autoSubmitted}` };
  }

  // Microsoft and long-standing conventions for the same thing.
  if ((headers['x-auto-response-suppress'] ?? '').length > 0) {
    return { accept: false, reason: 'auto_reply', detail: 'x-auto-response-suppress' };
  }
  if (['auto-replied', 'auto-generated', 'auto_reply'].includes((headers['x-autoreply'] ?? '').toLowerCase())) {
    return { accept: false, reason: 'auto_reply', detail: 'x-autoreply' };
  }
  const precedence = (headers.precedence ?? '').toLowerCase();
  if (['bulk', 'junk', 'auto_reply', 'list'].includes(precedence)) {
    return { accept: false, reason: 'auto_reply', detail: `precedence: ${precedence}` };
  }

  // A bounce has an empty envelope sender; replying to one bounces again.
  if (message.fromAddress === '' || message.fromAddress === '<>') {
    return { accept: false, reason: 'loop_detected', detail: 'null envelope sender' };
  }

  // Our own address writing to us is a loop by definition.
  if (options.ownAddresses.some((own) => own.toLowerCase() === message.fromAddress.toLowerCase())) {
    return { accept: false, reason: 'loop_detected', detail: 'from our own address' };
  }

  if (options.recentFromSender >= options.maxPerSenderPerHour) {
    return { accept: false, reason: 'rate_limited', detail: `${options.recentFromSender} in the last hour` };
  }

  return { accept: true };
}

function lowerKeys(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key.toLowerCase()] = value;
  }
  return out;
}
