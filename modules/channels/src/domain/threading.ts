/**
 * Working out which ticket an inbound email belongs to
 * (docs/architecture/07 §6).
 *
 * Four sources of truth, tried in order of how hard each is to get wrong:
 *
 *   1. A signed token in a header we set ourselves. Survives every client, is
 *      not shown to the user, and cannot be typed in by accident.
 *   2. `In-Reply-To` / `References`. Standards-based and reliable, but lost
 *      when someone forwards rather than replies.
 *   3. A token in the subject. Visible, so it survives a forward — and equally,
 *      a person can paste it into an unrelated mail.
 *   4. Nothing matched: a new ticket.
 *
 * The order matters because the weaker sources are the ones an attacker or a
 * confused mail client can influence. Each match records *how* it matched, so
 * "why did this land on that ticket?" is answerable.
 */

export type ThreadMatch =
  | { kind: 'header-token'; ticketRef: string }
  | { kind: 'references'; messageIds: string[] }
  | { kind: 'subject-token'; ticketRef: string }
  | { kind: 'new' };

/** The header the platform stamps on everything it sends. */
export const TICKET_HEADER = 'x-itsm-ticket';

/**
 * `INC-000123` or `REQ-000123` in a subject, conventionally in brackets.
 *
 * Anchored to the bracketed form: a bare "INC-000123" in the body of a sentence
 * is far more likely to be someone talking about a ticket than replying to it.
 */
const SUBJECT_TOKEN = /\[\s*((?:INC|REQ|CHG|PRB|TSK)-\d{4,})\s*\]/i;

/** The reference list, newest last, as the standard defines it. */
export function parseReferences(headers: Record<string, string | undefined>): string[] {
  const raw = [headers['in-reply-to'], headers.references].filter(Boolean).join(' ');
  const ids = raw.match(/<[^>\s]+>/g) ?? [];
  // De-duplicated but order-preserving: the last is the immediate parent.
  return [...new Set(ids)];
}

export function subjectToken(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const match = SUBJECT_TOKEN.exec(subject);
  return match ? match[1]!.toUpperCase() : null;
}

export function resolveThread(headers: Record<string, string | undefined>, subject: string | null): ThreadMatch {
  const lower = Object.fromEntries(
    Object.entries(headers).filter(([, v]) => v !== undefined).map(([k, v]) => [k.toLowerCase(), v as string]),
  );

  const stamped = lower[TICKET_HEADER];
  if (stamped && /^[A-Z]{3}-\d{4,}$/i.test(stamped.trim())) {
    return { kind: 'header-token', ticketRef: stamped.trim().toUpperCase() };
  }

  const references = parseReferences(lower);
  if (references.length > 0) return { kind: 'references', messageIds: references };

  const token = subjectToken(subject);
  if (token) return { kind: 'subject-token', ticketRef: token };

  return { kind: 'new' };
}

/**
 * Strips quoted history from a reply.
 *
 * Without this every reply carries the entire thread, and the ticket becomes
 * unreadable after three exchanges — the single most common complaint about
 * email-fed service desks. Conservative on purpose: when no marker is found the
 * text is left alone, because losing what somebody wrote is far worse than
 * keeping too much.
 */
const QUOTE_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}/im,
  /^_{5,}\s*$/m,
  /^on .{10,80}\bwrote:\s*$/im,
  /^from:\s.+\bsent:\s/ims,
  /^\s*>{1,}\s?.*(\n\s*>{1,}\s?.*){3,}/m,
];

export function stripQuotedReply(body: string): string {
  let earliest = body.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(body);
    if (match && match.index < earliest) earliest = match.index;
  }
  const trimmed = body.slice(0, earliest).trim();
  // A reply that is *only* quoted text still said something by existing, so
  // returning nothing would lose it; keep the original in that case.
  return trimmed.length > 0 ? trimmed : body.trim();
}

/** The `Message-ID` the platform stamps, so its own replies thread correctly. */
export function outboundMessageId(ticketNumber: string, sequence: number, domain: string): string {
  return `<${ticketNumber.toLowerCase()}.${sequence}@${domain}>`;
}

/** The subject for an outbound message, carrying the visible token once. */
export function outboundSubject(ticketNumber: string, subject: string): string {
  return subjectToken(subject) ? subject : `[${ticketNumber}] ${subject}`;
}
