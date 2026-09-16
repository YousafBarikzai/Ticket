import { describe, expect, it, vi } from 'vitest';
import {
  afterAttempt,
  afterNoAnswer,
  backoffMs,
  dueNow,
  isQueueable,
  needsAttention,
  newItem,
  outcomeOf,
  pendingCount,
  MAX_ATTEMPTS,
  QUEUEABLE,
  type OutboxItem,
} from '../outbox.js';
import { enqueue, forgetSent, memoryOutboxStore, SENT_RETENTION_MS } from '../store.js';
import { drainOutbox, retryable } from '../sync.js';
import { isCacheable, isQueueablePath, routeFor } from '../routing.js';

/**
 * The queue's rules, which are the whole of it.
 *
 * Every test here names something that goes wrong on a train: a comment sent
 * twice, a decision replayed after somebody else made it, a request that
 * retries for ever against a server that will never accept it.
 */

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    ...newItem({ action: 'add-comment', path: '/api/proxy/api/v1/tickets/INC-1/comments', body: {}, summary: 'a reply' }, 1000),
    ...overrides,
  };
}

describe('what may be queued at all', () => {
  it('is three actions, and they are all additive', () => {
    // Additive: none of them depends on the state of the thing it touches, so
    // a delay changes *when* they happen and not whether they were right. A
    // transition would not qualify.
    expect([...QUEUEABLE]).toEqual(['report-issue', 'add-comment', 'decide-approval']);
    expect(isQueueable('transition')).toBe(false);
    expect(isQueueable('submit-request')).toBe(false);
  });

  it('recognises the paths those actions post to, and nothing else', () => {
    expect(isQueueablePath('/api/proxy/api/v1/tickets')).toBe(true);
    expect(isQueueablePath('/api/proxy/api/v1/tickets/INC-1/comments')).toBe(true);
    expect(isQueueablePath('/api/proxy/api/v1/approvals/a-1/decide')).toBe(true);

    expect(isQueueablePath('/api/proxy/api/v1/tickets/INC-1/transitions')).toBe(false);
    expect(isQueueablePath('/api/proxy/api/v1/tickets/INC-1')).toBe(false);
    expect(isQueueablePath('/api/proxy/api/v1/catalogue/laptop/submit')).toBe(false);
  });
});

describe('the idempotency key', () => {
  it('is minted when the person acts, and rides every retry', () => {
    // This is the whole point of the queue. Two drains racing — a background
    // sync and an `online` event — must raise one ticket.
    const queued = newItem({ action: 'report-issue', path: '/api/proxy/api/v1/tickets', body: {}, summary: 'x' });
    const afterOne = afterNoAnswer(queued);
    const afterTwo = afterNoAnswer(afterOne);
    expect(afterTwo.idempotencyKey).toBe(queued.idempotencyKey);
  });

  it('differs between two things queued separately', () => {
    const one = newItem({ action: 'add-comment', path: '/p', body: {}, summary: 'a' });
    const two = newItem({ action: 'add-comment', path: '/p', body: {}, summary: 'b' });
    expect(one.idempotencyKey).not.toBe(two.idempotencyKey);
  });
});

describe('what an answer means', () => {
  it('treats a replayed create as a success', () => {
    // 409 on a create with an idempotency key is the API saying "you already
    // sent this". That is success arriving by a different door.
    expect(outcomeOf(409, 'report-issue')).toBe('sent');
    expect(outcomeOf(409, 'add-comment')).toBe('sent');
  });

  it('treats a replayed decision as a conflict, because somebody else decided', () => {
    expect(outcomeOf(409, 'decide-approval')).toBe('conflict');
  });

  it('treats the world having moved as news, not as an error', () => {
    for (const status of [410, 422, 428]) {
      expect(outcomeOf(status, 'add-comment')).toBe('conflict');
    }
    // The ticket was purged while the comment waited.
    expect(outcomeOf(404, 'add-comment')).toBe('conflict');
    // A 404 on a create is a wrong path, which is a bug rather than news.
    expect(outcomeOf(404, 'report-issue')).toBe('failed');
  });

  it('keeps trying where trying could work', () => {
    expect(outcomeOf(0, 'add-comment')).toBe('pending');
    expect(outcomeOf(429, 'add-comment')).toBe('pending');
    expect(outcomeOf(503, 'add-comment')).toBe('pending');
    // A lapsed session comes back when the person signs in again.
    expect(outcomeOf(401, 'add-comment')).toBe('pending');
  });

  it('gives up where trying cannot work', () => {
    expect(outcomeOf(400, 'add-comment')).toBe('failed');
    expect(outcomeOf(403, 'add-comment')).toBe('failed');
  });
});

describe('retrying', () => {
  it('backs off, and stops backing off at ten minutes', () => {
    // Capped because what is being waited for is usually somebody walking out
    // of a tunnel, and an hour-long backoff turns a thirty-second outage into
    // a ticket that arrives after they have phoned.
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(3)).toBe(40_000);
    expect(backoffMs(20)).toBe(600_000);
  });

  it('gives up after five attempts rather than for ever', () => {
    let current = item();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      current = afterAttempt(current, { status: 503 }, 1000);
      expect(current.status).toBe('pending');
    }
    current = afterAttempt(current, { status: 503 }, 1000);
    expect(current.status).toBe('failed');
    expect(current.attempts).toBe(MAX_ATTEMPTS);
    expect(current.problem).toMatch(/5 attempts/);
  });

  it('keeps the API’s own words when it sent any', () => {
    const conflicted = afterAttempt(item(), { status: 422, detail: 'this ticket is closed' });
    expect(conflicted.problem).toBe('this ticket is closed');
  });

  it('says something useful when it did not', () => {
    expect(afterAttempt(item(), { status: 422 }).problem).toMatch(/changed while it was waiting/);
  });

  it('resets the count when a person asks again', () => {
    // They have information the queue does not: they have seen the problem and
    // believe it is fixed.
    const given = afterAttempt(item({ attempts: 4 }), { status: 503 }, 1000);
    expect(given.status).toBe('failed');

    const asked = retryable(given, 5000);
    expect(asked.status).toBe('pending');
    expect(asked.attempts).toBe(0);
    expect(asked.nextAttemptAt).toBe(5000);
    expect(asked.problem).toBeNull();
  });
});

describe('what is due', () => {
  it('is what is pending and past its backoff, oldest first', () => {
    const older = item({ id: 'a', queuedAt: 100, nextAttemptAt: 100 });
    const newer = item({ id: 'b', queuedAt: 200, nextAttemptAt: 100 });
    const waiting = item({ id: 'c', queuedAt: 50, nextAttemptAt: 9_000 });
    const done = item({ id: 'd', queuedAt: 10, status: 'sent' });

    expect(dueNow([newer, waiting, done, older], 1000).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('counts what is still in flight, and what a person has to look at', () => {
    const items = [
      item({ id: 'a', status: 'pending' }),
      item({ id: 'b', status: 'sending' }),
      item({ id: 'c', status: 'sent' }),
      item({ id: 'd', status: 'conflict' }),
      item({ id: 'e', status: 'failed' }),
    ];
    expect(pendingCount(items)).toBe(2);
    expect(needsAttention(items).map((entry) => entry.id)).toEqual(['d', 'e']);
  });
});

describe('draining', () => {
  function answering(statuses: readonly number[]): typeof fetch {
    let call = 0;
    return vi.fn(async () => new Response('{}', { status: statuses[call++] ?? 200 })) as unknown as typeof fetch;
  }

  it('sends the queued key, not a new one', async () => {
    const store = memoryOutboxStore();
    const queued = await enqueue(store, {
      action: 'report-issue',
      path: '/api/proxy/api/v1/tickets',
      body: { title: 'x' },
      summary: 'x',
    });

    const doFetch = answering([201]);
    await drainOutbox(store, { fetchImpl: doFetch });

    const [, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(queued.idempotencyKey);
  });

  it('sends one at a time, oldest first', async () => {
    const store = memoryOutboxStore([
      item({ id: 'second', queuedAt: 200, body: { n: 2 } }),
      item({ id: 'first', queuedAt: 100, body: { n: 1 } }),
    ]);
    const doFetch = answering([201, 201]);
    await drainOutbox(store, { fetchImpl: doFetch, now: () => 1000 });

    const calls = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ n: 1 });
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ n: 2 });
  });

  it('reports what happened to each', async () => {
    const store = memoryOutboxStore([
      item({ id: 'a', queuedAt: 1 }),
      item({ id: 'b', queuedAt: 2 }),
      item({ id: 'c', queuedAt: 3 }),
    ]);
    const report = await drainOutbox(store, { fetchImpl: answering([201, 422, 503]), now: () => 1000 });

    expect(report).toMatchObject({ attempted: 3, sent: 1, conflicted: 1, failed: 0, remaining: 1 });
  });

  it('leaves everything pending when the network is gone', async () => {
    const store = memoryOutboxStore([item({ id: 'a' })]);
    const doFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const report = await drainOutbox(store, { fetchImpl: doFetch, now: () => 1000 });
    expect(report.remaining).toBe(1);
    expect((await store.all())[0]!.status).toBe('pending');
  });

  it('does not send an item twice when two drains overlap', async () => {
    // Marked `sending` before the request, so a second drain starting while
    // this one is in flight passes over it.
    const store = memoryOutboxStore([item({ id: 'a' })]);
    let inFlight: (() => void) | null = null;
    const doFetch = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          inFlight = () => resolve(new Response('{}', { status: 201 }));
        }),
    ) as unknown as typeof fetch;

    const first = drainOutbox(store, { fetchImpl: doFetch, now: () => 1000 });
    await vi.waitFor(() => expect(inFlight).not.toBeNull());

    const second = await drainOutbox(store, { fetchImpl: doFetch, now: () => 1000 });
    expect(second.attempted).toBe(0);

    inFlight!();
    await first;
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('reads the API’s problem detail onto the item', async () => {
    const store = memoryOutboxStore([item({ id: 'a' })]);
    const doFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: 'Unprocessable', detail: 'that ticket is closed' }), { status: 422 }),
    ) as unknown as typeof fetch;

    await drainOutbox(store, { fetchImpl: doFetch, now: () => 1000 });
    expect((await store.all())[0]!.problem).toBe('that ticket is closed');
  });
});

describe('forgetting what was sent', () => {
  it('keeps a sent item for an hour, so a page can say so', async () => {
    const store = memoryOutboxStore([
      item({ id: 'recent', status: 'sent', queuedAt: 1000 }),
      item({ id: 'old', status: 'sent', queuedAt: 1000 }),
    ]);

    expect(await forgetSent(store, 1000 + SENT_RETENTION_MS - 1)).toBe(0);
    expect(await forgetSent(store, 1000 + SENT_RETENTION_MS + 1)).toBe(2);
    expect(await store.all()).toHaveLength(0);
  });

  it('never forgets something that still needs a person', async () => {
    const store = memoryOutboxStore([item({ id: 'a', status: 'conflict', queuedAt: 0 })]);
    await forgetSent(store, Date.now());
    expect(await store.all()).toHaveLength(1);
  });
});

describe('what the service worker caches', () => {
  it('never touches anything about a session', () => {
    // A cached sign-in response is somebody else's session served to the next
    // person on a shared machine.
    for (const path of ['/api/session/login', '/api/session/callback', '/api/session/logout']) {
      expect(routeFor({ method: 'GET', url: `https://x.test${path}` }).strategy).toBe('network-only');
      expect(routeFor({ method: 'POST', url: `https://x.test${path}` }).strategy).toBe('network-only');
    }
  });

  it('serves the page from the network, falling back to the shell', () => {
    expect(routeFor({ method: 'GET', url: 'https://x.test/tickets', mode: 'navigate' })).toEqual({
      strategy: 'shell',
      cache: 'shell',
    });
  });

  it('reads the API network-first, because a stale queue is worse than a slow one', () => {
    expect(routeFor({ method: 'GET', url: 'https://x.test/api/proxy/api/v1/tickets' })).toEqual({
      strategy: 'network-first',
      cache: 'api',
    });
  });

  it('never caches an event stream', () => {
    expect(routeFor({ method: 'GET', url: 'https://x.test/api/proxy/api/v1/events/stream' }).strategy).toBe(
      'network-only',
    );
  });

  it('trusts content-hashed build output, and revalidates everything else', () => {
    expect(routeFor({ method: 'GET', url: 'https://x.test/_next/static/chunks/a1b2.js' }).strategy).toBe('cache-first');
    expect(routeFor({ method: 'GET', url: 'https://x.test/icon.svg' }).strategy).toBe('stale-while-revalidate');
  });

  it('marks only the three queueable writes, and leaves other writes alone', () => {
    expect(routeFor({ method: 'POST', url: 'https://x.test/api/proxy/api/v1/tickets' }).strategy).toBe('queueable');
    expect(routeFor({ method: 'POST', url: 'https://x.test/api/proxy/api/v1/tickets/INC-1/transitions' }).strategy).toBe(
      'network-only',
    );
    expect(routeFor({ method: 'DELETE', url: 'https://x.test/api/proxy/api/v1/tickets/INC-1' }).strategy).toBe(
      'network-only',
    );
  });

  it('refuses to cache a response that is not an answer', () => {
    // An opaque response has status 0 and an unreadable body, so caching it
    // stores a hole that later serves as a failure.
    expect(isCacheable({ status: 200 })).toBe(true);
    expect(isCacheable({ status: 200, type: 'opaque' })).toBe(false);
    expect(isCacheable({ status: 206 })).toBe(false);
    expect(isCacheable({ status: 404 })).toBe(false);
    expect(isCacheable({ status: 0, type: 'error' })).toBe(false);
  });
});
