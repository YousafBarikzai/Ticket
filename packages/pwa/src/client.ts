'use client';

import { useCallback, useEffect, useState } from 'react';
import { OUTBOX_DRAINED } from './messages.js';
import {
  isQueueable,
  needsAttention,
  newIdempotencyKey,
  pendingCount,
  type OutboxItem,
  type OutboxStore,
  type QueueInput,
} from './outbox.js';
import { enqueue, forgetSent, outboxStore } from './store.js';
import { drainOutbox, retryable } from './sync.js';

/**
 * The page's half of the offline story.
 *
 * Registration, an honest online/offline reading, and the queue as something a
 * person can look at. Three things here are decisions rather than plumbing:
 *
 * **`navigator.onLine` is not "the internet works".** It reports whether the
 * machine has *a* network interface, so a hotel captive portal and a VPN that
 * has dropped both read as online. The queue therefore never trusts it to
 * decide whether to send — it tries, and a failure is what puts something in
 * the queue. `onLine` is used only to decide when it is worth *trying again*.
 *
 * **Queuing happens where the person acted.** `submitOrQueue` sends, and on a
 * network failure puts the request in the outbox and tells the caller so the
 * screen can say "we will send this when you are back" rather than "that did
 * not work".
 *
 * **Nothing is queued silently.** A caller has to name the action, and the
 * action has to be one of the three doc 14 §5 allows.
 *
 * **One key per intent.** `submitOrQueue` mints the idempotency key once and
 * sends that same key online, stores it with the queued copy, and hands it
 * back so a Retry after a 503 can send it again. It used to send none online
 * and mint a fresh one for the queue, so a request whose answer was lost on
 * the way back — sent, created, then "failed" — raised a second ticket.
 */

const DRAIN_TAG = 'itsm-outbox';

export async function registerServiceWorker(url = '/sw.js'): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(url, { scope: '/' });
  } catch {
    // A refused registration — an insecure origin, a blocked scope, a browser
    // with it switched off — is not worth a message. Everything still works;
    // it simply works online only.
    return null;
  }
}

/** Asks the browser to drain when the network returns, or drains here if it will not. */
export async function requestDrain(): Promise<void> {
  // `getRegistration()`, not `ready`: `ready` never settles on a page with no
  // active worker — an insecure origin, a refused registration — and a drain
  // waiting on it would wait for ever, with the queue it was meant to empty.
  const registration =
    typeof navigator === 'undefined'
      ? undefined
      : await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  const sync = registration?.active
    ? (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
    : undefined;

  if (sync) {
    try {
      // The browser will fire this when it judges the network to be back —
      // possibly long after this tab has closed, which is the case the queue
      // exists for.
      await sync.register(DRAIN_TAG);
      return;
    } catch {
      // Permission refused, or too many registrations. Fall through.
    }
  }
  await drainOutbox(await outboxStore());
}

export interface SubmitResult {
  readonly ok: boolean;
  /** True when it went into the outbox instead of to the server. */
  readonly queued: boolean;
  readonly response?: Response;
  /**
   * The key this attempt carried, online or queued. Pass it back as
   * `idempotencyKey` to retry the same thing — after a 503, say — so the
   * retry cannot become a second copy.
   */
  readonly idempotencyKey: string;
}

/** Seams for the tests; a page passes nothing. */
export interface SubmitDeps {
  readonly fetchImpl?: typeof fetch;
  readonly store?: OutboxStore;
  /** What to do once something is queued. Defaults to `requestDrain`. */
  readonly afterQueue?: () => Promise<void>;
}

/**
 * Sends, and queues it if the network is not there.
 *
 * A *server* answer — any answer, including a refusal — is returned to the
 * caller unchanged, because a 422 is something the person has to fix now and
 * queuing it would hide that. Only "no answer at all" queues.
 *
 * The key is minted here only when the caller has not already minted one for
 * this intent, and the same key rides the online attempt, the queued copy and
 * every drain of it.
 */
export async function submitOrQueue(input: QueueInput, deps: SubmitDeps = {}): Promise<SubmitResult> {
  // The type already says so; this is for the caller whose `action` arrived
  // as a string. Refused before anything is sent, not only when it would be
  // queued, so the mistake shows up online rather than on a train.
  if (!isQueueable(input.action)) throw new TypeError(`"${String(input.action)}" is not an action the outbox may hold`);
  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  const doFetch = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(input.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(input.body),
    });
  } catch {
    const store = deps.store ?? (await outboxStore());
    await enqueue(store, { ...input, idempotencyKey });
    void (deps.afterQueue ?? requestDrain)().catch(() => undefined);
    return { ok: false, queued: true, idempotencyKey };
  }
  return { ok: response.ok, queued: false, response, idempotencyKey };
}

export interface OutboxView {
  readonly items: readonly OutboxItem[];
  readonly pending: number;
  readonly attention: readonly OutboxItem[];
  readonly online: boolean;
  refresh: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

export function useOutbox(pollMs = 15_000): OutboxView {
  const [items, setItems] = useState<readonly OutboxItem[]>([]);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    const store = await outboxStore();
    await forgetSent(store);
    setItems(await store.all());
  }, []);

  const retry = useCallback(
    async (id: string) => {
      const store = await outboxStore();
      const found = (await store.all()).find((item) => item.id === id);
      if (!found) return;
      // A person pressing "try again" has information the queue does not — they
      // have seen the problem and believe it is fixed — so the backoff resets.
      await store.put(retryable(found));
      await drainOutbox(store);
      await refresh();
    },
    [refresh],
  );

  const dismiss = useCallback(
    async (id: string) => {
      const store = await outboxStore();
      await store.delete(id);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();

    // `onLine` decides only when to *try*, never whether something is sendable.
    const goOnline = (): void => {
      setOnline(true);
      void requestDrain().then(refresh);
    };
    const goOffline = (): void => setOnline(false);

    setOnline(navigator.onLine);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const listener = (event: MessageEvent): void => {
      if ((event.data as { type?: string } | null)?.type === OUTBOX_DRAINED) void refresh();
    };
    navigator.serviceWorker?.addEventListener('message', listener);

    // Each tick also sends whatever is due. Background sync exists only in
    // Chromium, and `online` fires only after an `offline` — so a request that
    // failed while the machine still believed it was connected (the tunnel,
    // the dropped VPN) would otherwise wait for a person to press Retry. The
    // drain respects each item's backoff, so this is not a retry every tick.
    const tick = async (): Promise<void> => {
      if (navigator.onLine) await drainOutbox(await outboxStore()).catch(() => undefined);
      await refresh();
    };
    const timer = setInterval(() => void tick(), pollMs);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', listener);
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  return {
    items,
    pending: pendingCount(items),
    attention: needsAttention(items),
    online,
    refresh,
    retry,
    dismiss,
  };
}
