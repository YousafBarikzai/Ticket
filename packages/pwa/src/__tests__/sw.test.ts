import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The worker itself, loaded against a stand-in for its global scope.
 *
 * Only the decisions are tested here — whether it takes over on install, what
 * it does when asked to, what it keeps and where — not a browser installing
 * it, which needs a browser (doc 14 §10.3).
 */

type Listener = (event: Record<string, unknown>) => void;

const listeners = new Map<string, Listener>();
const scope = {
  addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  skipWaiting: vi.fn(async () => undefined),
  clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => []) },
};

const keyOf = (request: string | { url: string }): string =>
  new URL(typeof request === 'string' ? request : request.url, 'https://x.test').href;

class FakeCache {
  readonly entries = new Map<string, Response>();
  async put(request: string | { url: string }, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response);
  }
  async add(request: string | { url: string }): Promise<void> {
    this.entries.set(keyOf(request), new Response('offline page', { status: 200 }));
  }
  async match(request: string | { url: string }): Promise<Response | undefined> {
    return this.entries.get(keyOf(request))?.clone();
  }
}

const stores = new Map<string, FakeCache>();
const cacheStorage = {
  open: async (name: string) => {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name)!;
  },
  keys: async () => [...stores.keys()],
  delete: async (name: string) => stores.delete(name),
  match: async (request: string | { url: string }) => {
    for (const cache of stores.values()) {
      const found = await cache.match(request);
      if (found) return found;
    }
    return undefined;
  },
};

let network: (request: unknown) => Promise<Response>;

/** A `Request` that, like one in a worker, resolves a path against its origin. */
class ScopedRequest extends Request {
  constructor(input: string | URL | Request, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, 'https://x.test') : input, init);
  }
}

function dispatch(type: string, extra: Record<string, unknown> = {}): Promise<unknown[]> {
  const pending: Promise<unknown>[] = [];
  listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => pending.push(promise), ...extra });
  return Promise.all(pending);
}

async function fetchThrough(url: string): Promise<Response | undefined> {
  let responded: Promise<Response> | undefined;
  listeners.get('fetch')!({
    request: { method: 'GET', url: `https://x.test${url}`, mode: 'cors' },
    respondWith: (answer: Promise<Response>) => {
      responded = answer;
    },
  });
  return responded;
}

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('Request', ScopedRequest);
  vi.stubGlobal('fetch', (request: unknown) => network(request));
  await import('../sw.js');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  stores.clear();
  scope.skipWaiting.mockClear();
  scope.clients.claim.mockClear();
  network = async () => new Response('{}', { status: 200 });
});

describe('an update', () => {
  it('installs without taking over, keeping only the offline page', async () => {
    // Taking over on install swapped the caching rules under a tab that was
    // half-way through a reply. It now waits to be asked.
    await dispatch('install');
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    expect([...stores.get('itsm-shell-dev')!.entries.keys()]).toEqual(['https://x.test/offline']);
  });

  it('takes over when the page says the person chose to reload', async () => {
    await dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('ignores a message it does not know', async () => {
    await dispatch('message', { data: { type: 'something-else' } });
    await dispatch('message', { data: null });
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it('on activating, deletes every older cache of its own and claims the open tabs', async () => {
    for (const name of ['itsm-shell-dev', 'itsm-api-dev', 'itsm-api-0ld', 'itsm-assets-0ld', 'not-ours']) {
      await cacheStorage.open(name);
    }
    await dispatch('activate');
    expect([...stores.keys()].sort()).toEqual(['itsm-api-dev', 'itsm-shell-dev', 'not-ours']);
    expect(scope.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('the workbench’s aggregation handlers', () => {
  it('are kept in the API cache when the network answers', async () => {
    network = async () => new Response('{"items":[]}', { status: 200 });
    const response = await fetchThrough('/api/desk/inbox/mine');
    expect(await response!.text()).toBe('{"items":[]}');
    expect(stores.get('itsm-api-dev')!.entries.has('https://x.test/api/desk/inbox/mine')).toBe(true);
  });

  it('answer from that cache, marked as such, when it does not', async () => {
    const cache = await cacheStorage.open('itsm-api-dev');
    await cache.put('/api/desk/inbox/mine', new Response('{"items":["INC-1"]}', { status: 200 }));
    network = async () => {
      throw new TypeError('fetch failed');
    };

    const response = await fetchThrough('/api/desk/inbox/mine');
    expect(response!.headers.get('x-itsm-from-cache')).toBe('1');
    expect(await response!.text()).toBe('{"items":["INC-1"]}');
  });
});

describe('a session that ends', () => {
  it('takes the cached inbox and tickets with it', async () => {
    const cache = await cacheStorage.open('itsm-api-dev');
    await cache.put('/api/desk/inbox/mine', new Response('{"items":["INC-1"]}', { status: 200 }));
    network = async () => new Response('{"title":"Unauthorised"}', { status: 401 });

    const response = await fetchThrough('/api/desk/inbox/mine');
    expect(response!.status).toBe(401);
    expect(stores.has('itsm-api-dev')).toBe(false);

    // Offline afterwards, there is nothing left to show.
    network = async () => {
      throw new TypeError('fetch failed');
    };
    expect((await fetchThrough('/api/desk/inbox/mine'))!.status).toBe(503);
  });
});
