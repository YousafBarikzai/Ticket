import { describe, expect, it } from 'vitest';
import { clearLocalData, isDraftKey, isPersonalCache } from '../clear.js';
import { cachedPages } from '../offline-pages.js';
import { newItem } from '../outbox.js';
import { memoryOutboxStore } from '../store.js';

/**
 * Sign-out on a shared machine (SPEC F19, §5.1).
 *
 * The next person at the front-desk PC must not find the last person's
 * tickets in the offline page, their reply in the outbox, or their half-written
 * report restored into the form. What is nobody's — the build's static files,
 * the device's display preferences — stays.
 */

function cacheStorage(names: string[]) {
  const held = new Set(names);
  return {
    held,
    keys: async () => [...held],
    delete: async (name: string) => held.delete(name),
  };
}

function storage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
  };
}

const QUEUED = newItem({
  action: 'add-comment',
  path: '/api/proxy/api/v1/tickets/INC-1/comments',
  body: { body: 'On my way' },
  summary: 'On my way',
});

describe('what counts as somebody’s', () => {
  it('is the page and API caches, not the build’s assets', () => {
    expect(isPersonalCache('itsm-shell-3f2a1b')).toBe(true);
    expect(isPersonalCache('itsm-api-3f2a1b')).toBe(true);
    expect(isPersonalCache('itsm-assets-3f2a1b')).toBe(false);
    expect(isPersonalCache('some-other-app')).toBe(false);
  });

  it('is every draft the apps write, and not the display preferences', () => {
    expect(isDraftKey('itsm-draft:report:u-1')).toBe(true);
    expect(isDraftKey('itsm-draft:form:laptop@3')).toBe(true);
    expect(isDraftKey('itsm-wb-draft:INC-000123')).toBe(true);

    expect(isDraftKey('itsm-prefs')).toBe(false);
    expect(isDraftKey('itsm-theme')).toBe(false);
    expect(isDraftKey('itsm-wb-drafts-help-seen')).toBe(false);
    expect(isDraftKey('draft:report')).toBe(false);
  });
});

describe('clearLocalData', () => {
  it('clears the page and API caches, the outbox and the drafts, and keeps the rest', async () => {
    const caches = cacheStorage(['itsm-shell-v1', 'itsm-api-v1', 'itsm-assets-v1', 'itsm-api-v0']);
    const store = memoryOutboxStore([QUEUED]);
    const local = storage({
      'itsm-prefs': '{"theme":"apple-dark"}',
      'itsm-draft:report:u-1': '{"title":"VPN"}',
      'itsm-wb-draft:INC-1': 'On my way',
      'other-app': 'x',
    });
    const session = storage({ 'itsm-draft:form:laptop@3': '{}' });

    const report = await clearLocalData({ caches, store, storages: [local, session] });

    expect([...caches.held]).toEqual(['itsm-assets-v1']);
    expect(await store.all()).toHaveLength(0);
    expect([...local.map.keys()]).toEqual(['itsm-prefs', 'other-app']);
    expect(session.map.size).toBe(0);
    expect(report).toEqual({ caches: 3, outbox: 1, keys: 3 });
  });

  it('clears further keys the app names as this person’s', async () => {
    const local = storage({ 'itsm-wb-seen': '{}', 'itsm-prefs': '{}' });
    await clearLocalData({
      caches: null,
      store: null,
      storages: [local],
      alsoKeys: (key) => key === 'itsm-wb-seen',
    });
    expect([...local.map.keys()]).toEqual(['itsm-prefs']);
  });

  it('carries on past a part that fails', async () => {
    // A blocked cache API is no reason to leave the outbox full.
    const store = memoryOutboxStore([QUEUED]);
    const local = storage({ 'itsm-draft:report:u-1': '{}' });
    const broken = {
      keys: async (): Promise<string[]> => {
        throw new Error('SecurityError');
      },
      delete: async () => false,
    };

    const report = await clearLocalData({ caches: broken, store, storages: [local] });
    expect(report).toEqual({ caches: 0, outbox: 1, keys: 1 });
    expect(await store.all()).toHaveLength(0);
    expect(local.map.size).toBe(0);
  });

  it('works where there are no caches at all, as on an insecure origin', async () => {
    const report = await clearLocalData({ caches: null, store: memoryOutboxStore(), storages: [] });
    expect(report).toEqual({ caches: 0, outbox: 0, keys: 0 });
  });
});

describe('what this device can show offline', () => {
  function withPages(byCache: Record<string, string[]>) {
    return {
      keys: async () => Object.keys(byCache),
      open: async (name: string) =>
        ({ keys: async () => (byCache[name] ?? []).map((url) => new Request(url)) }) as unknown as Cache,
    };
  }

  it('lists the pages the worker kept, once each, and not the offline page itself', async () => {
    const pages = await cachedPages(
      withPages({
        'itsm-shell-v1': ['https://x.test/offline', 'https://x.test/tickets/INC-1', 'https://x.test/inbox/mine?t=INC-1'],
        'itsm-shell-v0': ['https://x.test/tickets/INC-1'],
        // API answers are not pages.
        'itsm-api-v1': ['https://x.test/api/desk/counts'],
      }),
    );
    expect(pages).toEqual(['/inbox/mine?t=INC-1', '/tickets/INC-1']);
  });

  it('lists nothing where there are no caches', async () => {
    expect(await cachedPages(null)).toEqual([]);
  });
});
