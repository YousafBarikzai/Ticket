'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalItsm } from './ItsmProvider.js';

/**
 * Something a person opened recently or pinned, as the palette and the
 * sidebar list it. Keys and labels only — never ticket content — because it is
 * kept in this device's `localStorage`.
 */
export interface RecentItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** What it is: `ticket`, `rule`, `article`… Groups the list and picks its icon. */
  readonly kind: string;
  readonly meta?: string;
}

export interface Pins {
  readonly pins: readonly RecentItem[];
  pin(item: RecentItem): void;
  unpin(id: string): void;
  isPinned(id: string): boolean;
}

/** The palette's "Recent" shows eight: enough to find yesterday's work, few enough to scan. */
export const MAX_RECENTS = 8;
/** A generous cap; how many pins the sidebar shows is `NavModel.pinned.max`. */
export const MAX_PINS = 50;
/** Labels longer than this are cut: they are for recognising an item in a list, not for reading. */
const MAX_TEXT = 200;

type ListKind = 'recents' | 'pins';

/** `itsm-recents:<app>` or `itsm-recents:<app>:<scope>`, and the same for pins. */
export function recentsStorageKey(kind: ListKind, app: string, scope?: string): string {
  return `itsm-${kind}:${app}${scope ? `:${scope}` : ''}`;
}

/**
 * Whether a storage key holds someone's recents or pins — for sign-out, which
 * forgets a person's local data on a shared machine
 * (`clearLocalData({ alsoKeys: isRecentsKey })` in `@itsm/pwa`).
 */
export function isRecentsKey(key: string): boolean {
  return /^itsm-(?:recents|pins):/.test(key);
}

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : null;
}

/** One stored item, or `null` for anything that is not recognisably one. */
function sanitise(value: unknown): RecentItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const label = text(record.label);
  const href = text(record.href, 2000);
  const kind = text(record.kind, 40);
  // Only same-origin paths: a stored item is followed without asking, so it
  // must not be able to send a person to another site.
  if (!id || !label || !href || !kind || !href.startsWith('/') || href.startsWith('//')) return null;
  const meta = text(record.meta);
  return meta ? { id, label, href, kind, meta } : { id, label, href, kind };
}

const EMPTY: readonly RecentItem[] = Object.freeze([]);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * One list in `localStorage`, shared by every component that reads it and
 * kept in step with other tabs through the `storage` event. Reads and writes
 * never throw: private browsing, a full quota or a blocked origin simply mean
 * the list lives only as long as the page.
 */
class ListStore {
  private items: readonly RecentItem[] | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly key: string,
    private readonly max: number,
  ) {}

  readonly getSnapshot = (): readonly RecentItem[] => {
    if (this.items === null) this.items = this.read();
    return this.items;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) window.addEventListener('storage', this.onStorage);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) window.removeEventListener('storage', this.onStorage);
    };
  };

  update(change: (items: readonly RecentItem[]) => readonly RecentItem[]): void {
    const next = change(this.getSnapshot()).slice(0, this.max);
    this.items = next;
    try {
      storage()?.setItem(this.key, JSON.stringify(next));
    } catch {
      // Kept in memory for this page; the next page starts without it.
    }
    this.emit();
  }

  private read(): readonly RecentItem[] {
    try {
      const raw = storage()?.getItem(this.key);
      if (!raw) return EMPTY;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return EMPTY;
      const seen = new Set<string>();
      const items: RecentItem[] = [];
      for (const entry of parsed) {
        const item = sanitise(entry);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      return items.slice(0, this.max);
    } catch {
      return EMPTY;
    }
  }

  private readonly onStorage = (event: StorageEvent): void => {
    // A null key is `localStorage.clear()` in another tab — sign-out, say.
    if (event.key !== null && event.key !== this.key) return;
    this.items = null;
    this.emit();
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

const stores = new Map<string, ListStore>();

function storeFor(kind: ListKind, app: string, scope: string | undefined): ListStore {
  const key = recentsStorageKey(kind, app, scope);
  let store = stores.get(key);
  if (!store) {
    store = new ListStore(key, kind === 'recents' ? MAX_RECENTS : MAX_PINS);
    stores.set(key, store);
  }
  return store;
}

/** Forgets every list held in memory. Tests use it between cases. */
export function resetRecentsForTesting(): void {
  stores.clear();
}

function useStore(kind: ListKind): ListStore {
  const context = useOptionalItsm();
  return storeFor(kind, context?.app ?? 'default', context?.storageScope);
}

function useList(store: ListStore): readonly RecentItem[] {
  // The server snapshot is empty: the server cannot see this device's
  // storage, so the first client render must not either (SPEC §3.6 rule 8).
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
}

/**
 * Records a visit to the current entity (at most 8 per app, newest first).
 * Call it on the page or drawer that shows the entity; a repeat visit moves
 * the item to the top and refreshes its label.
 */
export function useRecordRecent(item: RecentItem): void {
  const store = useStore('recents');
  const { id, label, href, kind, meta } = item;
  useEffect(() => {
    const clean = sanitise({ id, label, href, kind, meta });
    if (!clean) return;
    store.update((items) => [clean, ...items.filter((existing) => existing.id !== clean.id)]);
  }, [store, id, label, href, kind, meta]);
}

/** The recent items, newest first. Empty on the server and during hydration. */
export function useRecents(): readonly RecentItem[] {
  return useList(useStore('recents'));
}

/** Items pinned "on this device", in the order they were pinned. */
export function usePins(): Pins {
  const store = useStore('pins');
  const pins = useList(store);
  const pin = useCallback(
    (item: RecentItem) => {
      const clean = sanitise(item);
      if (!clean) return;
      store.update((items) => (items.some((existing) => existing.id === clean.id) ? items : [...items, clean]));
    },
    [store],
  );
  const unpin = useCallback((id: string) => store.update((items) => items.filter((existing) => existing.id !== id)), [store]);
  return useMemo(
    () => ({ pins, pin, unpin, isPinned: (id: string) => pins.some((existing) => existing.id === id) }),
    [pins, pin, unpin],
  );
}
