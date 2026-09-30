import type { OutboxStore } from './outbox.js';
import { outboxStore } from './store.js';

/**
 * Forgetting a person on sign-out.
 *
 * A service desk runs on shared machines — the front desk, the lab, the
 * laptop lent for the week — and everything this package keeps is somebody's:
 * the pages they opened (`itsm-shell-*`), the API answers behind them
 * (`itsm-api-*`, including the workbench's `/api/desk/*`), the messages still
 * waiting to be sent, and the drafts they were writing. Signing out used to
 * clear none of it, so the next person's offline page could list the last
 * person's tickets and send the last person's queued reply under the new
 * session.
 *
 * What stays is what is nobody's: the build's own static files
 * (`itsm-assets-*`) and the device's display preferences (`itsm-prefs`).
 *
 * Each part is cleared on its own and a failure in one does not stop the
 * others — a blocked `localStorage` is no reason to leave the outbox full.
 * The caller asks first when something is still queued ("2 messages haven't
 * been sent. Sign out and discard them?"): this function does not.
 */

/** The caches that hold what a person saw. */
export function isPersonalCache(name: string): boolean {
  return name.startsWith('itsm-shell-') || name.startsWith('itsm-api-');
}

/**
 * A draft somebody was writing: `itsm-draft:report:<user>`,
 * `itsm-draft:form:<key>@<version>`, `itsm-wb-draft:<ticket>`.
 */
export function isDraftKey(key: string): boolean {
  return /^itsm-(?:[a-z0-9]+-)*draft(?:[:-]|$)/.test(key);
}

type CacheStorageLike = Pick<CacheStorage, 'keys' | 'delete'>;
type StorageLike = Pick<Storage, 'length' | 'key' | 'removeItem'>;

export interface ClearOptions {
  /** Defaults to the page's `caches`; absent on an insecure origin. */
  readonly caches?: CacheStorageLike | null;
  /** Defaults to the page's outbox. */
  readonly store?: OutboxStore | null;
  /** Defaults to `localStorage` and `sessionStorage`. */
  readonly storages?: readonly StorageLike[];
  /** Further keys that are this person's — `itsm-wb-seen`, say — beyond drafts. */
  readonly alsoKeys?: (key: string) => boolean;
}

export interface ClearReport {
  readonly caches: number;
  readonly outbox: number;
  readonly keys: number;
}

function defaultStorages(): StorageLike[] {
  const found: StorageLike[] = [];
  // Merely reading either property throws where storage is blocked.
  try {
    if (typeof localStorage !== 'undefined') found.push(localStorage);
  } catch {
    // Nothing to clear there.
  }
  try {
    if (typeof sessionStorage !== 'undefined') found.push(sessionStorage);
  } catch {
    // Nor there.
  }
  return found;
}

async function clearCaches(cacheStorage: CacheStorageLike | null | undefined): Promise<number> {
  if (!cacheStorage) return 0;
  let cleared = 0;
  for (const name of await cacheStorage.keys()) {
    if (isPersonalCache(name) && (await cacheStorage.delete(name))) cleared += 1;
  }
  return cleared;
}

async function clearOutbox(store: OutboxStore | null | undefined): Promise<number> {
  if (!store) return 0;
  const items = await store.all();
  for (const item of items) await store.delete(item.id);
  return items.length;
}

function clearKeys(storages: readonly StorageLike[], alsoKeys?: (key: string) => boolean): number {
  let cleared = 0;
  for (const storage of storages) {
    try {
      // Collected first: removing while walking by index skips the key that
      // slides into the removed one's place.
      const doomed: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null && (isDraftKey(key) || alsoKeys?.(key) === true)) doomed.push(key);
      }
      for (const key of doomed) storage.removeItem(key);
      cleared += doomed.length;
    } catch {
      // A storage that throws holds nothing this can reach.
    }
  }
  return cleared;
}

export async function clearLocalData(options: ClearOptions = {}): Promise<ClearReport> {
  const cacheStorage =
    options.caches !== undefined ? options.caches : typeof caches === 'undefined' ? null : caches;

  const [cachesCleared, outboxCleared] = await Promise.all([
    clearCaches(cacheStorage).catch(() => 0),
    (async () => clearOutbox(options.store !== undefined ? options.store : await outboxStore()))().catch(() => 0),
  ]);
  const keys = clearKeys(options.storages ?? defaultStorages(), options.alsoKeys);

  return { caches: cachesCleared, outbox: outboxCleared, keys };
}
