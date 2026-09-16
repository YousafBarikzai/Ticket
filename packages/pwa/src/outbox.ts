/**
 * The offline outbox (doc 14 §5).
 *
 * What a person does on a service desk portal while their train is in a tunnel
 * has to survive the tunnel. This is the queue that makes that true, and it is
 * written as pure logic over a storage interface because every interesting
 * thing about it is a rule rather than a database call:
 *
 * **The set of queueable actions is closed.** Three: report an issue, add a
 * comment, decide an approval. Not "any POST". A queue that will replay
 * anything is a queue that replays a transition somebody made against a ticket
 * that has since moved, or a catalogue submission against an item that was
 * retired — and it replays it hours later with no way to explain the result.
 * The three here are all *additive*: none of them depends on the state of the
 * thing it touches, so a delay changes when they happen and not whether they
 * were right.
 *
 * **The idempotency key is minted when the person acts, not when it is sent.**
 * That is the whole point. A retry hours later carries the same key as the
 * first attempt, so a queue that syncs twice — two tabs, a background sync and
 * an `online` event racing — raises one ticket.
 *
 * **A conflict is not a failure.** A comment on a ticket that was closed while
 * the queue waited comes back 409 or 422. That is news for the person, not an
 * error to retry until it stops, so it lands in `conflict` and is shown.
 *
 * **Retries are bounded and backed off.** An item that has failed five times
 * against a server that keeps refusing it is not going to succeed on the
 * sixth; it becomes `failed` and waits for a person.
 */

export const QUEUEABLE = ['report-issue', 'add-comment', 'decide-approval'] as const;
export type QueueableAction = (typeof QUEUEABLE)[number];

export function isQueueable(action: string): action is QueueableAction {
  return (QUEUEABLE as readonly string[]).includes(action);
}

export type ItemStatus = 'pending' | 'sending' | 'sent' | 'conflict' | 'failed';

export interface OutboxItem {
  readonly id: string;
  readonly action: QueueableAction;
  /** The path on the proxy, e.g. `/api/proxy/api/v1/tickets`. */
  readonly path: string;
  readonly method: 'POST';
  readonly body: unknown;
  /** Minted when the person acted. The same key rides every retry. */
  readonly idempotencyKey: string;
  readonly status: ItemStatus;
  readonly attempts: number;
  readonly queuedAt: number;
  /** When it may next be tried. Backoff, not a timer. */
  readonly nextAttemptAt: number;
  /** What a person should be told. Set for `conflict` and `failed`. */
  readonly problem: string | null;
  /** What it was about, for the list: "VPN will not connect". */
  readonly summary: string;
}

/** Storage, narrow enough that IndexedDB and a Map both satisfy it. */
export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  delete(id: string): Promise<void>;
}

export const MAX_ATTEMPTS = 5;

/**
 * How long to wait before attempt *n*.
 *
 * Exponential from ten seconds, capped at ten minutes. Capped because the
 * thing being waited for is usually a person walking out of a tunnel, and an
 * hour-long backoff turns a thirty-second outage into a ticket that arrives
 * after they have given up and phoned.
 */
export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 10_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Which HTTP answers mean what.
 *
 * `sent` — it worked, or it had already worked: 409 on a *create* with an
 * idempotency key is the API saying "you already sent this", which is success
 * arriving by a different door.
 *
 * `conflict` — the request was well-formed and the world had moved: the ticket
 * was closed, the approval was decided by somebody else. A person has to see
 * it; retrying cannot help.
 *
 * `failed` — the request was wrong and will be wrong again. 400, 403, and a
 * 404 on a create.
 *
 * `pending` — nobody answered, or the server was unwell. Try again.
 */
export function outcomeOf(status: number, action: QueueableAction): ItemStatus {
  // 0 is "no answer at all" — the tunnel, not the server.
  if (status === 0) return 'pending';
  if (status >= 200 && status < 300) return 'sent';
  // A replayed create is a success. A replayed *decision* is not: two people
  // deciding one approval is a conflict somebody must be told about.
  if (status === 409) return action === 'decide-approval' ? 'conflict' : 'sent';
  if (status === 410 || status === 422 || status === 428) return 'conflict';
  // A 404 on something that already existed is the world having moved — the
  // ticket was purged, the approval withdrawn. A 404 on a *create* is a wrong
  // path, which is a bug rather than news.
  if (status === 404) return action === 'report-issue' ? 'failed' : 'conflict';
  if (status === 401) return 'pending'; // The session lapsed; it comes back.
  if (status === 429 || status >= 500) return 'pending';
  return 'failed';
}

export interface QueueInput {
  readonly action: QueueableAction;
  readonly path: string;
  readonly body: unknown;
  readonly summary: string;
  readonly idempotencyKey?: string;
}

function newKey(): string {
  return `pwa-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function newItem(input: QueueInput, now = Date.now()): OutboxItem {
  return {
    id: newKey(),
    action: input.action,
    path: input.path,
    method: 'POST',
    body: input.body,
    idempotencyKey: input.idempotencyKey ?? newKey(),
    status: 'pending',
    attempts: 0,
    queuedAt: now,
    nextAttemptAt: now,
    problem: null,
    summary: input.summary,
  };
}

/** Everything due, oldest first — so a comment written before another arrives first. */
export function dueNow(items: readonly OutboxItem[], now = Date.now()): OutboxItem[] {
  return items
    .filter((item) => item.status === 'pending' && item.nextAttemptAt <= now)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

export function pendingCount(items: readonly OutboxItem[]): number {
  return items.filter((item) => item.status === 'pending' || item.status === 'sending').length;
}

/** What a person has to look at: a conflict, or something that gave up. */
export function needsAttention(items: readonly OutboxItem[]): OutboxItem[] {
  return items.filter((item) => item.status === 'conflict' || item.status === 'failed');
}

export interface Attempt {
  readonly status: number;
  /** The API's problem detail, where it sent one. */
  readonly detail?: string | undefined;
}

/**
 * The item after one attempt.
 *
 * Pure, and the reason the whole outbox is testable: every rule about retries,
 * conflicts and giving up is this function, and none of it needs a network.
 */
export function afterAttempt(item: OutboxItem, attempt: Attempt, now = Date.now()): OutboxItem {
  const attempts = item.attempts + 1;
  const outcome = outcomeOf(attempt.status, item.action);

  if (outcome === 'sent') {
    return { ...item, status: 'sent', attempts, problem: null };
  }
  if (outcome === 'conflict') {
    return {
      ...item,
      status: 'conflict',
      attempts,
      problem: attempt.detail ?? 'This changed while it was waiting to be sent.',
    };
  }
  if (outcome === 'failed') {
    return { ...item, status: 'failed', attempts, problem: attempt.detail ?? 'This was refused and will not be retried.' };
  }

  // Worth trying again — unless it has already had its five.
  if (attempts >= MAX_ATTEMPTS) {
    return {
      ...item,
      status: 'failed',
      attempts,
      problem: attempt.detail ?? `This could not be sent after ${MAX_ATTEMPTS} attempts.`,
    };
  }
  return { ...item, status: 'pending', attempts, nextAttemptAt: now + backoffMs(attempts), problem: null };
}

/** The item after the network refused to answer at all. Always worth another go. */
export function afterNoAnswer(item: OutboxItem, now = Date.now()): OutboxItem {
  return afterAttempt(item, { status: 0 }, now);
}
