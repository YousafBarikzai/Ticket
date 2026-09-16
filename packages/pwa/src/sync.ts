import { afterAttempt, dueNow, type OutboxItem, type OutboxStore } from './outbox.js';

/**
 * Draining the outbox.
 *
 * One item at a time, oldest first. Not in parallel, and that is deliberate:
 * two comments a person wrote in order must arrive in that order, and a
 * parallel drain against a slow connection reorders them for no gain that
 * anybody on a train would notice.
 *
 * The function takes its `fetch` and its clock, so the whole of it is testable
 * without a network, a browser or a wait — and so the service worker and the
 * page can share one implementation rather than each having their own idea of
 * when to give up.
 */

export interface SyncDeps {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /** Called after each item changes, so a page can re-render as the queue empties. */
  readonly onChange?: (item: OutboxItem) => void;
}

export interface SyncReport {
  readonly attempted: number;
  readonly sent: number;
  readonly conflicted: number;
  readonly failed: number;
  /** Still pending, so the caller knows whether to ask again. */
  readonly remaining: number;
}

/** The API's problem detail, if it sent one. Never the whole body. */
async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { detail?: unknown; title?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.title === 'string') return body.title;
  } catch {
    // Not a problem document. The status is enough.
  }
  return undefined;
}

export async function drainOutbox(store: OutboxStore, deps: SyncDeps = {}): Promise<SyncReport> {
  const doFetch = deps.fetchImpl ?? fetch;
  const clock = deps.now ?? Date.now;

  const due = dueNow(await store.all(), clock());
  let sent = 0;
  let conflicted = 0;
  let failed = 0;

  for (const item of due) {
    // Marked before the request, so a second drain starting while this one is
    // in flight does not send it twice. The idempotency key would make that
    // harmless at the API; it would still be a wasted round trip and a
    // confusing log.
    await store.put({ ...item, status: 'sending' });

    let updated: OutboxItem;
    try {
      const response = await doFetch(item.path, {
        method: item.method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // The key minted when the person acted, not now. This is what makes
          // a replay safe.
          'idempotency-key': item.idempotencyKey,
        },
        body: JSON.stringify(item.body),
      });
      updated = afterAttempt(item, { status: response.status, detail: await detailOf(response) }, clock());
    } catch {
      // No answer at all: the network, not the server.
      updated = afterAttempt(item, { status: 0 }, clock());
    }

    await store.put(updated);
    deps.onChange?.(updated);

    if (updated.status === 'sent') sent += 1;
    else if (updated.status === 'conflict') conflicted += 1;
    else if (updated.status === 'failed') failed += 1;
  }

  const remaining = (await store.all()).filter((item) => item.status === 'pending').length;
  return { attempted: due.length, sent, conflicted, failed, remaining };
}

/**
 * Puts a `failed` item back in the queue, at the front of the backoff.
 *
 * A person pressing "try again" has new information the queue does not have —
 * they have seen the problem and believe it is fixed — so their press resets
 * the attempt count rather than continuing a backoff that has already given up.
 */
export function retryable(item: OutboxItem, now = Date.now()): OutboxItem {
  return { ...item, status: 'pending', attempts: 0, nextAttemptAt: now, problem: null };
}
