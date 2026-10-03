import { DEMO_LOCAL_KEYS } from '@itsm/contracts/demo';
import { describe, expect, it } from 'vitest';
import { clearDemoLocalData, isDemoLocalKey, readDemoGeneration, storeDemoGeneration } from '../demo.js';
import { memoryOutboxStore } from '../store.js';
import { newItem } from '../outbox.js';

/**
 * `@itsm/pwa/demo` (A3 §6.10): when the shared demo is rebuilt, the visit's
 * local data is forgotten with sign-out's machinery and the new generation is
 * recorded, so the reset notice is said once. Storage here is the browser's
 * least reliable part — private windows throw, quotas fill — so every case
 * that can throw is tried.
 */

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, value);
  }
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  keys(): string[] {
    return [...this.map.keys()].sort();
  }
}

/** A storage whose every method throws, as a blocked one does. */
const throwing: Storage = {
  get length(): number {
    throw new Error('SecurityError');
  },
  clear() {
    throw new Error('SecurityError');
  },
  getItem() {
    throw new Error('SecurityError');
  },
  key() {
    throw new Error('SecurityError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

function fakeCaches(names: string[]): Pick<CacheStorage, 'keys' | 'delete'> & { names: string[] } {
  const state = { names: [...names] };
  return {
    get names() {
      return state.names;
    },
    keys: async () => [...state.names],
    delete: async (name: string) => {
      const had = state.names.includes(name);
      state.names = state.names.filter((entry) => entry !== name);
      return had;
    },
  };
}

describe('the demo generation this browser last saw', () => {
  it('reads back what it stored, under the contract key', () => {
    const storage = new MemoryStorage();
    expect(readDemoGeneration(storage)).toBeNull();
    expect(storeDemoGeneration(7, storage)).toBe(true);
    expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('7');
    expect(DEMO_LOCAL_KEYS.lastGeneration).toBe('itsm-demo:last-gen');
    expect(readDemoGeneration(storage)).toBe(7);
  });

  it('treats anything that is not a generation as none, and refuses to store one', () => {
    for (const raw of ['', 'abc', '0', '-3', '2.5', 'NaN', '1e400']) {
      expect(readDemoGeneration(new MemoryStorage({ [DEMO_LOCAL_KEYS.lastGeneration]: raw })), raw).toBeNull();
    }
    const storage = new MemoryStorage();
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(storeDemoGeneration(bad, storage), String(bad)).toBe(false);
    expect(storage.length).toBe(0);
  });

  it('survives a storage that throws, and no storage at all', () => {
    expect(readDemoGeneration(throwing)).toBeNull();
    expect(storeDemoGeneration(3, throwing)).toBe(false);
    expect(readDemoGeneration(null)).toBeNull();
    expect(storeDemoGeneration(3, null)).toBe(false);
  });

  it('knows its own two keys, and no others', () => {
    expect(isDemoLocalKey('itsm-demo:last-gen')).toBe(true);
    expect(isDemoLocalKey('itsm-demo:notice-seen')).toBe(true);
    expect(isDemoLocalKey('itsm-demo:other')).toBe(false);
    expect(isDemoLocalKey('itsm-recents:workbench')).toBe(false);
  });
});

describe('clearDemoLocalData', () => {
  it('clears the visit with sign-out’s machinery — caches, outbox, drafts, the app’s keys — then stores the generation', async () => {
    const storage = new MemoryStorage({
      'itsm-recents:workbench:u1': '[]',
      'itsm-pins:workbench:u1': '[]',
      'itsm-wb-draft:INC-000123': 'half a reply',
      'itsm-wb-seen': '{}',
      'itsm-prefs': '{"appearance":"dark"}',
      [DEMO_LOCAL_KEYS.lastGeneration]: '4',
      [DEMO_LOCAL_KEYS.noticeSeen]: '4',
    });
    const caches = fakeCaches(['itsm-shell-v1', 'itsm-api-v1', 'itsm-assets-v1']);
    const store = memoryOutboxStore();
    await store.put(newItem({ action: 'add-comment', path: '/api/proxy/api/v1/tickets/INC-1/comments', body: { body: 'hi' }, summary: 'Reply to INC-1' }, 1_000));

    const report = await clearDemoLocalData({
      generation: 5,
      caches,
      store,
      storages: [storage],
      generationStorage: storage,
      alsoKeys: (key) => /^itsm-(?:recents|pins):/.test(key) || key.startsWith('itsm-wb-'),
    });

    expect(report).toEqual({ caches: 2, outbox: 1, keys: 4 });
    expect(caches.names).toEqual(['itsm-assets-v1']);
    expect(await store.all()).toEqual([]);
    // What is nobody's stays: the device's display preferences, and the bar's own records.
    expect(storage.keys()).toEqual(['itsm-demo:last-gen', 'itsm-demo:notice-seen', 'itsm-prefs']);
    expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('5');
  });

  it('never clears the bar’s own records, whatever the application’s predicate says', async () => {
    const storage = new MemoryStorage({ [DEMO_LOCAL_KEYS.lastGeneration]: '2', [DEMO_LOCAL_KEYS.noticeSeen]: '2', 'itsm-demo:x': '1' });
    await clearDemoLocalData({ generation: 3, caches: null, store: null, storages: [storage], generationStorage: storage, alsoKeys: (key) => key.startsWith('itsm-demo:') });
    expect(storage.keys()).toEqual(['itsm-demo:last-gen', 'itsm-demo:notice-seen']);
    expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('3');
    expect(storage.getItem(DEMO_LOCAL_KEYS.noticeSeen)).toBe('2');
  });

  it('survives a throwing localStorage: nothing is cleared there, nothing is stored, and it still resolves', async () => {
    const caches = fakeCaches(['itsm-api-v1']);
    const report = await clearDemoLocalData({ generation: 9, caches, store: null, storages: [throwing], generationStorage: throwing, alsoKeys: () => true });
    expect(report).toEqual({ caches: 1, outbox: 0, keys: 0 });
    expect(caches.names).toEqual([]);
  });

  it('still records the generation when the caches cannot be read', async () => {
    const storage = new MemoryStorage();
    const broken: Pick<CacheStorage, 'keys' | 'delete'> = {
      keys: async () => {
        throw new Error('no caches on an insecure origin');
      },
      delete: async () => false,
    };
    await expect(clearDemoLocalData({ generation: 2, caches: broken, store: null, storages: [storage], generationStorage: storage })).resolves.toEqual({
      caches: 0,
      outbox: 0,
      keys: 0,
    });
    expect(readDemoGeneration(storage)).toBe(2);
  });

  it('stores into localStorage by default', async () => {
    const storage = new MemoryStorage();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    try {
      await clearDemoLocalData({ generation: 11, caches: null, store: null, storages: [] });
      expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('11');
      expect(readDemoGeneration()).toBe(11);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
