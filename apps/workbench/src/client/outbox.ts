import { newIdempotencyKey, submitOrQueue, type OutboxItem, type SubmitDeps } from '@itsm/pwa';
import { ApiError } from '@itsm/sdk';

/**
 * Replies and notes that survive a tunnel (F20, ADR-0043).
 *
 * A comment is one of the three writes the outbox may hold: it is additive,
 * so sending it an hour late changes when it lands, not whether it was
 * right. `sendComment` tries the service now and, only when nobody answers,
 * puts the same request — with the same idempotency key — in the outbox,
 * which sends it when the connection is back. That is what makes the
 * workbench's old promise ("replies are queued while you're offline") true.
 *
 * A *server* answer, including a refusal, is never queued: a 403 or a 422 is
 * something the person has to know about now, so it comes back as an
 * `ApiError`, exactly as the SDK would throw it.
 */

export interface SendCommentInput {
  /** The ticket's number (or id). */
  readonly ticket: string;
  readonly body: string;
  readonly internal: boolean;
  /**
   * One key per intent: minted when the person presses Send and passed again
   * on a Retry of the same text, so a reply whose answer was lost on the way
   * back cannot land twice. New text is a new intent, and needs a new key.
   */
  readonly idempotencyKey: string;
}

export interface SentComment {
  readonly id: string;
  readonly visibility: 'public' | 'internal';
  readonly createdAt: string;
}

export type SendCommentResult =
  | { readonly status: 'sent'; readonly idempotencyKey: string; readonly comment: SentComment | null }
  | { readonly status: 'queued'; readonly idempotencyKey: string };

/** The proxy path a ticket's comments are posted to — also how a queued item is matched back to its ticket. */
export function commentPath(ticket: string): string {
  return `/api/proxy/api/v1/tickets/${encodeURIComponent(ticket)}/comments`;
}

/** What the connection tray lists for a queued comment: "Reply on INC-000123". */
export function commentSummary(ticket: string, internal: boolean): string {
  return `${internal ? 'Internal note' : 'Reply'} on ${ticket}`;
}

export { newIdempotencyKey };

export async function sendComment(input: SendCommentInput, deps: SubmitDeps = {}): Promise<SendCommentResult> {
  const result = await submitOrQueue(
    {
      action: 'add-comment',
      path: commentPath(input.ticket),
      // The API's vocabulary, not a boolean: an unrecognised `isInternal`
      // would be ignored and the note delivered to the requester.
      body: { body: input.body, visibility: input.internal ? 'internal' : 'public' },
      summary: commentSummary(input.ticket, input.internal),
      idempotencyKey: input.idempotencyKey,
    },
    deps,
  );
  if (result.queued) return { status: 'queued', idempotencyKey: result.idempotencyKey };

  const response = result.response;
  const parsed: unknown = response ? await response.json().catch(() => null) : null;
  if (!result.ok) {
    const status = response?.status ?? 0;
    const problem = parsed && typeof parsed === 'object' && 'status' in parsed ? (parsed as ConstructorParameters<typeof ApiError>[1]) : null;
    throw new ApiError(status, problem, problem?.detail ?? problem?.title ?? `the request failed with ${status}`);
  }
  const comment = parsed && typeof parsed === 'object' && 'id' in parsed ? (parsed as SentComment) : null;
  return { status: 'sent', idempotencyKey: result.idempotencyKey, comment };
}

/** Whether a queued item is a comment on this ticket (by number or id). */
export function isCommentFor(item: Pick<OutboxItem, 'action' | 'path'>, ...tickets: readonly string[]): boolean {
  return item.action === 'add-comment' && tickets.some((ticket) => item.path === commentPath(ticket));
}

/** A queued comment's text and visibility, read back from what the outbox holds. */
export function queuedComment(item: Pick<OutboxItem, 'body'>): { readonly body: string; readonly internal: boolean } | null {
  const body = item.body as { body?: unknown; visibility?: unknown } | null;
  if (!body || typeof body.body !== 'string') return null;
  return { body: body.body, internal: body.visibility === 'internal' };
}
