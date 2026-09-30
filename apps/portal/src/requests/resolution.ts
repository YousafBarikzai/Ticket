import { ApiError, queueable, type Ticket } from '@itsm/sdk';
import type { QueueInput, SubmitResult } from '@itsm/pwa';
import type { Problem } from '@itsm/ui';
import { problemOf } from '../client/useAction.js';
import { isTooLateToReopen } from './model.js';

/**
 * The requester's moves on their own request, made safe to press twice
 * (SPEC §6.3, §6.4 "resolution guesswork → two buttons", F37).
 *
 * Every move is written against the version the page read (`If-Match`).
 * When the answer is not a plain yes — a conflict, a missing precondition,
 * a refusal, or no answer at all — the request is read again and the
 * decision is made from what it says *now*:
 *
 *   - it is already where the person wanted it (their earlier press landed
 *     and only the answer was lost, or somebody else got there first): done;
 *   - it has moved somewhere the move no longer starts from: say so;
 *   - it is still where it was: a conflict is retried once on the fresh
 *     version; a refusal means the API will not let a requester make this
 *     move at all; no answer means nothing happened — try again.
 *
 * "No, still broken" is two writes, and their order is the point: **reopen
 * first**, then the message, with one idempotency key for that message per
 * intent. A refused reopen posts nothing; a message that fails after the
 * reopen is retried on its own with the same key, so a retry never reopens
 * twice and never posts the message twice (the old flow commented first and
 * reopened second, and a retry after a failed reopen posted the comment
 * again).
 *
 * No React here: the hero card and the list rows share it, and the tests
 * drive it with a fake API.
 */

/** The moves a requester may make (`isRequesterTransition`). */
export type RequesterMove = 'closed' | 'reopened' | 'cancelled' | 'resolved';

/** What the moves need of the API: the SDK's `transition` and `ticket`. */
export interface MoveApi {
  transition(number: string, to: string, version: number, reason?: string): Promise<unknown>;
  ticket(number: string): Promise<Pick<Ticket, 'status' | 'version'>>;
}

/** Sends a queueable write: `submitOrQueue`. */
export type Send = (input: QueueInput) => Promise<SubmitResult>;

export interface ResolutionDeps extends MoveApi {
  readonly send: Send;
}

const FINISHED = new Set(['resolved', 'closed', 'cancelled']);

/** Where each move may start from. */
const STARTS_FROM: Record<RequesterMove, (status: string) => boolean> = {
  closed: (status) => status === 'resolved',
  reopened: (status) => status === 'resolved',
  cancelled: (status) => status === 'new' || status === 'pending_requester',
  resolved: (status) => !FINISHED.has(status),
};

/**
 * Whether a status already means the move happened. A reopened request is
 * "back with us" in any open state — an agent who picked it up in the
 * meantime has done what the reopen asked for.
 */
const ARRIVED: Record<RequesterMove, (status: string) => boolean> = {
  closed: (status) => status === 'closed',
  reopened: (status) => !FINISHED.has(status),
  cancelled: (status) => status === 'cancelled',
  resolved: (status) => status === 'resolved' || status === 'closed',
};

export type MoveOutcome =
  | { readonly kind: 'done' }
  /** It moved on since the page was read, to `status`. */
  | { readonly kind: 'moved'; readonly status: string }
  /** The API does not let a requester make this move (a 403 while the request still waits for it). */
  | { readonly kind: 'refused' };

/**
 * Makes one move, safely (see above). Throws what cannot be decided here —
 * a 422 about the request, a lost session, a busy or broken service, or no
 * answer while nothing changed — for the caller to word.
 */
export async function moveRequest(api: MoveApi, number: string, version: number, to: RequesterMove, reason?: string): Promise<MoveOutcome> {
  const words = reason?.trim().slice(0, 2000);
  let failure: unknown;
  try {
    await api.transition(number, to, version, words || undefined);
    return { kind: 'done' };
  } catch (error) {
    failure = error;
  }

  const status = failure instanceof ApiError ? failure.status : 0;
  // Answers that say what happened without a second look.
  if (status === 401 || status === 404 || status === 422 || status === 429 || status >= 500) throw failure;

  let fresh: Pick<Ticket, 'status' | 'version'>;
  try {
    fresh = await api.ticket(number);
  } catch {
    throw failure;
  }
  if (ARRIVED[to](fresh.status)) return { kind: 'done' };
  if (!STARTS_FROM[to](fresh.status)) return { kind: 'moved', status: fresh.status };
  if (status === 409 || status === 428) {
    await api.transition(number, to, fresh.version, words || undefined);
    return { kind: 'done' };
  }
  if (status === 403) return { kind: 'refused' };
  // No answer, and nothing changed: the move never arrived.
  throw failure;
}

/* ------------------------------------------------------------ The message */

/** Said for them when the API cannot close a request for a requester: the desk's auto-close finishes it. */
export const CONFIRMED_MESSAGE = 'Confirmed fixed. Thanks!';

export type SendOutcome = { readonly ok: true; readonly queued: boolean } | { readonly ok: false; readonly problem: Problem };

/** A refusal read from the response the outbox handed back. */
export async function problemFromResponse(response: Response | undefined): Promise<Problem> {
  if (!response) return { status: 0, retryable: true };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const problem = body && typeof body === 'object' && 'status' in body ? (body as ConstructorParameters<typeof ApiError>[1]) : null;
  return problemOf(new ApiError(response.status, problem, problem?.detail ?? `the request failed with ${response.status}`));
}

/**
 * A public message on the request, with the caller's key for this intent.
 * Offline (no answer at all) it is queued with that key, and the outbox
 * sends it when the connection is back. A 409 on a create with a key is
 * the API saying it already has it.
 */
export async function sendMessage(send: Send, number: string, body: string, key: string): Promise<SendOutcome> {
  const request = queueable.comment(number, body);
  const result = await send({
    action: 'add-comment',
    path: `/api/proxy${request.path}`,
    body: request.body,
    summary: `Message on ${number}`,
    idempotencyKey: key,
  });
  if (result.queued) return { ok: true, queued: true };
  if (result.ok || result.response?.status === 409) return { ok: true, queued: false };
  return { ok: false, problem: await problemFromResponse(result.response) };
}

/* ------------------------------------------------------- Yes, it's fixed */

export type ConfirmOutcome =
  | { readonly kind: 'closed' }
  | { readonly kind: 'moved'; readonly status: string }
  /** Before PA1: the confirmation went in as a message, and auto-close finishes the job. */
  | { readonly kind: 'acknowledged'; readonly queued: boolean };

/**
 * "Yes, it's fixed": `closed` from `resolved` (PA1). Where the API still
 * refuses a requester that move, the honest fallback is a public message —
 * "Confirmed fixed. Thanks!" — that tells the desk, while the request closes
 * itself on schedule. The message carries the caller's key, so pressing
 * again cannot post it twice. Throws what the caller must word.
 */
export async function confirmFixed(deps: ResolutionDeps, number: string, version: number, key: string): Promise<ConfirmOutcome> {
  const outcome = await moveRequest(deps, number, version, 'closed');
  if (outcome.kind === 'done') return { kind: 'closed' };
  if (outcome.kind === 'moved') return outcome;
  const sent = await sendMessage(deps.send, number, CONFIRMED_MESSAGE, key);
  if (!sent.ok) throw new ProblemError(sent.problem);
  return { kind: 'acknowledged', queued: sent.queued };
}

/* ------------------------------------------------------ No, still broken */

export type ReopenOutcome =
  /** Reopened, and the message sent (or queued, to send when the connection is back). */
  | { readonly kind: 'done'; readonly queued: boolean }
  | { readonly kind: 'moved'; readonly status: string }
  /** Resolved too long ago to reopen (`ticket.reopen.windowDays`): report it again instead. */
  | { readonly kind: 'too-late' }
  | { readonly kind: 'refused' }
  /** Reopened, but the message did not send: retry the message alone. */
  | { readonly kind: 'message-failed'; readonly problem: Problem }
  /** Nothing happened. */
  | { readonly kind: 'failed'; readonly problem: Problem };

export interface ReopenInput {
  readonly number: string;
  readonly version: number;
  /** What is still happening, in their words: the reopen's reason and the message. */
  readonly text: string;
  /** One key per intent: the same text pressed again sends with the same key. */
  readonly key: string;
  /** The reopen already happened on an earlier press: send only the message. */
  readonly reopened: boolean;
}

export async function reopenWithMessage(deps: ResolutionDeps, input: ReopenInput): Promise<ReopenOutcome> {
  const text = input.text.trim();
  if (!input.reopened) {
    try {
      const outcome = await moveRequest(deps, input.number, input.version, 'reopened', text);
      if (outcome.kind === 'moved') return outcome;
      if (outcome.kind === 'refused') return outcome;
    } catch (error) {
      const problem = problemOf(error);
      if (isTooLateToReopen(problem)) return { kind: 'too-late' };
      return { kind: 'failed', problem };
    }
  }
  const sent = await sendMessage(deps.send, input.number, text, input.key);
  if (!sent.ok) return { kind: 'message-failed', problem: sent.problem };
  return { kind: 'done', queued: sent.queued };
}

/** A refusal carried as an error, for callers that word failures in one place. */
export class ProblemError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title ?? `failed with ${problem.status}`);
    this.name = 'ProblemError';
  }
}

/** The `Problem` behind any failure a move can throw. */
export function problemOfFailure(error: unknown): Problem {
  return error instanceof ProblemError ? error.problem : problemOf(error);
}
