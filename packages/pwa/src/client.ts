'use client';

import { useCallback, useEffect, useState } from 'react';
import { needsAttention, pendingCount, type OutboxItem, type QueueInput } from './outbox.js';
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
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  const sync = (registration as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | null)
    ?.sync;

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
}

/**
 * Sends, and queues it if the network is not there.
 *
 * A *server* answer — any answer, including a refusal — is returned to the
 * caller unchanged, because a 422 is something the person has to fix now and
 * queuing it would hide that. Only "no answer at all" queues.
 */
export async function submitOrQueue(input: QueueInput): Promise<SubmitResult> {
  const store = await outboxStore();
  const item = { ...input, idempotencyKey: input.idempotencyKey ?? undefined };

  try {
    const response = await fetch(input.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(item.idempotencyKey ? { 'idempotency-key': item.idempotencyKey } : {}),
      },
      body: JSON.stringify(input.body),
    });
    return { ok: response.ok, queued: false, response };
  } catch {
    await enqueue(store, input);
    void requestDrain();
    return { ok: false, queued: true };
  }
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
      if ((event.data as { type?: string } | null)?.type === 'itsm-outbox-drained') void refresh();
    };
    navigator.serviceWorker?.addEventListener('message', listener);

    const timer = setInterval(() => void refresh(), pollMs);

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
