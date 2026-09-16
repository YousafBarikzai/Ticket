import { newItem, type OutboxItem, type OutboxStore, type QueueInput } from './outbox.js';

/**
 * Where the outbox lives.
 *
 * IndexedDB rather than `localStorage`, for a reason that is not about size:
 * `localStorage` is synchronous and unavailable in a service worker, and the
 * worker is the half of this that has to read the queue when the page that
 * wrote it is gone. A queue only the tab can see is a queue that loses
 * everything the moment somebody closes the tab and walks to the platform.
 *
 * The in-memory implementation is not only for tests. Private browsing, a
 * blocked storage origin and a quota that is already full all make IndexedDB
 * throw, and the honest answer there is a queue that works until the tab
 * closes rather than a portal that will not let somebody report an issue.
 */

const DATABASE = 'itsm-outbox';
const STORE = 'items';
const VERSION = 1;

export function memoryOutboxStore(seed: readonly OutboxItem[] = []): OutboxStore {
  const items = new Map<string, OutboxItem>(seed.map((item) => [item.id, item]));
  return {
    async all() {
      return [...items.values()];
    },
    async put(item) {
      items.set(item.id, item);
    },
    async delete(id) {
      items.delete(id);
    },
  };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the outbox could not be opened'));
    // A second tab holding an old version open blocks the upgrade. Rejecting is
    // better than hanging: the caller falls back to memory and the person can
    // still act.
    request.onblocked = () => reject(new Error('the outbox is open in another tab at a different version'));
  });
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the outbox rejected a write'));
  });
}

export function indexedDbOutboxStore(): OutboxStore {
  let database: Promise<IDBDatabase> | null = null;
  const connection = (): Promise<IDBDatabase> => (database ??= open());

  return {
    async all() {
      const db = await connection();
      return promised(db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<OutboxItem[]>);
    },
    async put(item) {
      const db = await connection();
      await promised(db.transaction(STORE, 'readwrite').objectStore(STORE).put(item));
    },
    async delete(id) {
      const db = await connection();
      await promised(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    },
  };
}

/**
 * The store this environment can actually use.
 *
 * Tried once and remembered. A browser that refuses IndexedDB refuses it every
 * time, and probing on each call would turn one failure into a failure per
 * queued item.
 */
export async function outboxStore(): Promise<OutboxStore> {
  if (typeof indexedDB === 'undefined') return memoryOutboxStore();
  const candidate = indexedDbOutboxStore();
  try {
    await candidate.all();
    return candidate;
  } catch {
    return memoryOutboxStore();
  }
}

/** Adds something to the queue. The idempotency key is minted here, now. */
export async function enqueue(store: OutboxStore, input: QueueInput): Promise<OutboxItem> {
  const item = newItem(input);
  await store.put(item);
  return item;
}

/**
 * Forgets what has been sent.
 *
 * Kept for a while rather than deleted on success, so that "your message was
 * sent" is something the page can show rather than something it infers from
 * an item vanishing. An hour is long enough for somebody to come back to the
 * tab and see it.
 */
export const SENT_RETENTION_MS = 60 * 60_000;

export async function forgetSent(store: OutboxStore, now = Date.now()): Promise<number> {
  const items = await store.all();
  const stale = items.filter((item) => item.status === 'sent' && now - item.queuedAt > SENT_RETENTION_MS);
  for (const item of stale) await store.delete(item.id);
  return stale.length;
}
