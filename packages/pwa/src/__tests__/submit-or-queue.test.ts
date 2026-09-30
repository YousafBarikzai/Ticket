import { describe, expect, it, vi } from 'vitest';
import { submitOrQueue } from '../client.js';
import { afterAttempt, dueNow, MAX_ATTEMPTS, newIdempotencyKey, newItem, SENDING_LEASE_MS, type QueueInput } from '../outbox.js';
import { memoryOutboxStore, outboxStore } from '../store.js';
import { drainOutbox } from '../sync.js';

/**
 * One key per intent (SPEC F17).
 *
 * The bug this file exists for: the online attempt sent no idempotency key and
 * the queued copy was given a fresh one. A report whose *response* was lost —
 * created on the server, "failed" in the browser — was queued and replayed
 * under a new key, and the requester had two tickets for one problem. The key
 * is now minted once and the same key rides the online attempt, the queued
 * copy, every drain of it, and a Retry.
 */

const REPORT: QueueInput = {
  action: 'report-issue',
  path: '/api/proxy/api/v1/tickets',
  body: { title: 'VPN will not connect' },
  summary: 'VPN will not connect',
};

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch;

function answering(...statuses: number[]): FetchMock {
  let call = 0;
  return vi.fn(async () => new Response('{}', { status: statuses[call++] ?? 201 })) as unknown as FetchMock;
}

function unreachable(): FetchMock {
  return vi.fn(async () => {
    throw new TypeError('fetch failed');
  }) as unknown as FetchMock;
}

function keyOf(doFetch: FetchMock, call = 0): string | undefined {
  const init = doFetch.mock.calls[call]![1] as RequestInit;
  return (init.headers as Record<string, string>)['idempotency-key'];
}

const quiet = { afterQueue: async () => undefined };

describe('online', () => {
  it('sends a key even when the caller did not mint one, and hands it back', async () => {
    const doFetch = answering(201);
    const result = await submitOrQueue(REPORT, { fetchImpl: doFetch, store: memoryOutboxStore() });

    expect(result).toMatchObject({ ok: true, queued: false });
    expect(keyOf(doFetch)).toMatch(/^pwa-/);
    expect(result.idempotencyKey).toBe(keyOf(doFetch));
  });

  it('sends the caller’s key when it minted one for this intent', async () => {
    const doFetch = answering(201);
    const key = newIdempotencyKey();
    const result = await submitOrQueue({ ...REPORT, idempotencyKey: key }, { fetchImpl: doFetch });
    expect(keyOf(doFetch)).toBe(key);
    expect(result.idempotencyKey).toBe(key);
  });

  it('returns a server’s answer as it is, and queues nothing', async () => {
    // A 422 is something the person has to fix now; queuing it would hide it.
    const store = memoryOutboxStore();
    for (const status of [422, 503]) {
      const result = await submitOrQueue(REPORT, { fetchImpl: answering(status), store, ...quiet });
      expect(result.queued).toBe(false);
      expect(result.response?.status).toBe(status);
    }
    expect(await store.all()).toHaveLength(0);
  });

  it('refuses an action the outbox may not hold, before sending anything', async () => {
    const doFetch = answering(201);
    await expect(
      submitOrQueue({ ...REPORT, action: 'transition' as never }, { fetchImpl: doFetch }),
    ).rejects.toThrow(/not an action the outbox may hold/);
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe('the same key, online, queued and on retry', () => {
  it('queues the key the online attempt carried, not a new one', async () => {
    const store = memoryOutboxStore();
    const doFetch = unreachable();
    const afterQueue = vi.fn(async () => undefined);

    const result = await submitOrQueue(REPORT, { fetchImpl: doFetch, store, afterQueue });

    expect(result).toMatchObject({ ok: false, queued: true });
    const [queued] = await store.all();
    expect(queued!.idempotencyKey).toBe(keyOf(doFetch));
    expect(queued!.idempotencyKey).toBe(result.idempotencyKey);
    expect(afterQueue).toHaveBeenCalledTimes(1);
  });

  it('sends that key again when the queue drains', async () => {
    const store = memoryOutboxStore();
    const online = unreachable();
    const result = await submitOrQueue(REPORT, { fetchImpl: online, store, ...quiet });

    const later = answering(201);
    await drainOutbox(store, { fetchImpl: later });
    expect(keyOf(later)).toBe(result.idempotencyKey);
    expect(keyOf(later)).toBe(keyOf(online));
  });

  it('sends that key again when the person retries after a 503', async () => {
    const first = answering(503);
    const failed = await submitOrQueue(REPORT, { fetchImpl: first });

    const second = answering(201);
    await submitOrQueue({ ...REPORT, idempotencyKey: failed.idempotencyKey }, { fetchImpl: second });
    expect(keyOf(second)).toBe(keyOf(first));
  });

  it('keeps one key through an online attempt, the queue and several drains', async () => {
    const store = memoryOutboxStore();
    const online = unreachable();
    await submitOrQueue(REPORT, { fetchImpl: online, store, ...quiet });

    const keys: (string | undefined)[] = [keyOf(online)];
    let now = Date.now();
    for (const status of [503, 502, 201]) {
      const doFetch = answering(status);
      now += 11 * 60_000; // past any backoff
      await drainOutbox(store, { fetchImpl: doFetch, now: () => now });
      keys.push(keyOf(doFetch));
    }
    expect(new Set(keys).size).toBe(1);
    expect((await store.all())[0]!.status).toBe('sent');
  });

  it('gives two separate reports two keys', async () => {
    const doFetch = answering(201, 201);
    await submitOrQueue(REPORT, { fetchImpl: doFetch });
    await submitOrQueue(REPORT, { fetchImpl: doFetch });
    expect(keyOf(doFetch, 0)).not.toBe(keyOf(doFetch, 1));
  });
});

describe('the outbox the page uses', () => {
  it('is one store, so what one screen queues another can list', async () => {
    // Without IndexedDB (private browsing, a blocked origin) the fallback is
    // in memory — and a fresh memory store per call was a queue that forgot
    // each item the moment it was put there.
    const first = await outboxStore();
    const second = await outboxStore();
    expect(second).toBe(first);
  });
});

describe('waiting well', () => {
  it('never gives up on a message only because the network was not there', () => {
    // The tunnel is not the server refusing. The backoff still grows.
    let item = newItem(REPORT, 0);
    for (let attempt = 0; attempt < MAX_ATTEMPTS * 3; attempt += 1) item = afterAttempt(item, { status: 0 }, 0);
    expect(item.status).toBe('pending');
    expect(item.nextAttemptAt).toBe(10 * 60_000);
  });

  it('still gives up on a server that keeps refusing', () => {
    let item = newItem(REPORT, 0);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) item = afterAttempt(item, { status: 503 }, 0);
    expect(item.status).toBe('failed');
  });

  it('takes back an item a closed tab left “sending”, once its lease runs out', () => {
    const abandoned = { ...newItem(REPORT, 0), status: 'sending' as const, nextAttemptAt: 1_000 + SENDING_LEASE_MS };
    expect(dueNow([abandoned], 1_000)).toHaveLength(0);
    expect(dueNow([abandoned], 1_000 + SENDING_LEASE_MS)).toHaveLength(1);
  });

  it('does not bring back an item discarded while it was being sent', async () => {
    // A sign-out clears the queue; a drain already in flight must not write
    // the last person's message back for the next one to send.
    const store = memoryOutboxStore([newItem(REPORT, 0)]);
    let answer: (() => void) | null = null;
    const doFetch = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(new Response('{}', { status: 503 }));
        }),
    ) as unknown as typeof fetch;

    const draining = drainOutbox(store, { fetchImpl: doFetch, now: () => 1_000 });
    await vi.waitFor(() => expect(answer).not.toBeNull());
    for (const item of await store.all()) await store.delete(item.id);
    answer!();
    await draining;

    expect(await store.all()).toHaveLength(0);
  });
});
