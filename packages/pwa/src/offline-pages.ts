/**
 * What this device can show without a network: the pages the service worker
 * has kept, for the `/offline` screen's "Available offline" list.
 *
 * Read from the `itsm-shell-*` caches, which hold only pages somebody actually
 * opened — nothing is precached but `/offline` itself — so the list is honest
 * about its limits: a ticket nobody opened on this device is not on it.
 */

type CacheStorageLike = Pick<CacheStorage, 'keys' | 'open'>;

const OFFLINE_PATH = '/offline';

/** Paths with their query, sorted, each once; `/offline` itself left out. */
export async function cachedPages(cacheStorage?: CacheStorageLike | null): Promise<string[]> {
  const storage = cacheStorage !== undefined ? cacheStorage : typeof caches === 'undefined' ? null : caches;
  if (!storage) return [];

  const pages = new Set<string>();
  try {
    for (const name of await storage.keys()) {
      if (!name.startsWith('itsm-shell-')) continue;
      const cache = await storage.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.pathname === OFFLINE_PATH) continue;
        pages.add(`${url.pathname}${url.search}`);
      }
    }
  } catch {
    // A cache that cannot be read offers nothing to list.
  }
  return [...pages].sort();
}
