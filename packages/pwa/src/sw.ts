/// <reference lib="webworker" />
import { isCacheable, routeFor } from './routing.js';
import { drainOutbox } from './sync.js';
import { indexedDbOutboxStore } from './store.js';

/**
 * The service worker.
 *
 * Bundled by `infra/scripts/build-service-worker.ts` into each application's
 * `public/sw.js`, rather than through a framework plugin. One reason: a
 * service worker is the single piece of code in this product that can keep
 * serving a wrong answer after the code that produced it has been replaced,
 * so it is worth being able to read all of it in one file and to test the two
 * decisions it makes — what to cache, and what to queue — as pure functions
 * elsewhere.
 *
 * Deliberately not Workbox (doc 14 §5 says `@serwist/next`). Workbox's value
 * is its precache manifest, generated from the build's asset names; everything
 * here is runtime caching, which is a hundred lines and no build integration.
 * Revisit when there is an offline-first screen that has to work on a first
 * visit, which there is not.
 *
 * **Version the caches, and delete the old ones on activate.** A service
 * worker that never cleans up accumulates every build it has ever seen in the
 * user's storage quota, and the first thing that breaks is the thing it was
 * supposed to protect.
 */

declare const self: ServiceWorkerGlobalScope;

/** Replaced at build time with the build's own identifier. */
declare const __SW_VERSION__: string;

const VERSION = typeof __SW_VERSION__ === 'string' ? __SW_VERSION__ : 'dev';
const CACHES = {
  shell: `itsm-shell-${VERSION}`,
  assets: `itsm-assets-${VERSION}`,
  api: `itsm-api-${VERSION}`,
} as const;

/** The page shown when a navigation has no network and no cached page. */
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(CACHES.shell);
      // Only the offline page is precached. Everything else arrives by being
      // visited, which means a person who has never opened a page does not get
      // it offline — an honest limit, and better than a precache manifest that
      // goes stale.
      await shell.add(new Request(OFFLINE_URL, { cache: 'reload' })).catch(() => undefined);
      // Take over as soon as this is ready: waiting for every tab to close
      // means a fix ships when somebody reboots.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set<string>(Object.values(CACHES));
      for (const name of await caches.keys()) {
        if (name.startsWith('itsm-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const route = routeFor({ method: request.method, url: request.url, mode: request.mode });

  switch (route.strategy) {
    case 'shell':
      event.respondWith(navigate(request));
      return;
    case 'network-first':
      event.respondWith(networkFirst(request, CACHES.api));
      return;
    case 'cache-first':
      event.respondWith(cacheFirst(request, CACHES.assets));
      return;
    case 'stale-while-revalidate':
      event.respondWith(staleWhileRevalidate(request, CACHES.assets));
      return;
    default:
      // `network-only` and `queueable` both go to the network untouched. The
      // queue is the *page's* decision, not the worker's: only the page knows
      // what the person was doing, and a worker that silently swallowed a
      // failed POST would leave them looking at a spinner.
      return;
  }
});

async function navigate(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHES.shell);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) ?? (await caches.match(OFFLINE_URL));
    return cached ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      // Marked, so the page can say "this is what we had" rather than showing
      // a stale queue as though it were live.
      const headers = new Headers(cached.headers);
      headers.set('x-itsm-from-cache', '1');
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
    return new Response(
      JSON.stringify({ type: 'about:blank', title: 'Offline', status: 503, detail: 'no network, and nothing cached' }),
      { status: 503, headers: { 'content-type': 'application/problem+json' } },
    );
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached ?? ((await network) as Response);
}

/**
 * Background sync, where the browser has it.
 *
 * `sync` fires when the browser decides the network is back, which may be long
 * after the tab closed — which is the case this whole queue exists for. Where
 * it is unsupported (every browser but Chromium's), the page drains the queue
 * on `online` instead; the same function does both.
 */
self.addEventListener('sync', (event) => {
  const sync = event as ExtendableEvent & { tag?: string };
  if (sync.tag !== 'itsm-outbox') return;
  sync.waitUntil(drainOutbox(indexedDbOutboxStore()).then(() => undefined));
});

/** The page asking for a drain now — after a sign-in, or on `online`. */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type !== 'itsm-drain-outbox') return;
  event.waitUntil?.(
    drainOutbox(indexedDbOutboxStore()).then(async (report) => {
      for (const client of await self.clients.matchAll()) {
        client.postMessage({ type: 'itsm-outbox-drained', report });
      }
    }),
  );
});
