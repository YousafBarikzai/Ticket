'use client';

import { useSyncExternalStore } from 'react';

/**
 * "Don't show me this again" for banners, on this device.
 *
 * One `localStorage` key per notice, `itsm-dismissed:<dismissKey>`, holding the
 * time it was dismissed. Storage can be blocked (private mode, a strict
 * policy) or full; a dismissal then lasts as long as the page, from an
 * in-memory set, rather than throwing or refusing to close. Other tabs follow
 * through the `storage` event, so dismissing an incident banner in one tab
 * clears it from the others.
 */

export const DISMISSAL_PREFIX = 'itsm-dismissed:';

/** Whether a storage key is one of these, for sign-out's "clear what this person left here". */
export function isDismissalKey(key: string): boolean {
  return key.startsWith(DISMISSAL_PREFIX);
}

const remembered = new Set<string>();
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDismissed(key: string): boolean {
  if (remembered.has(key)) return true;
  try {
    return storage()?.getItem(DISMISSAL_PREFIX + key) != null;
  } catch {
    return false;
  }
}

/** Records a dismissal and tells every mounted banner with the same key. */
export function rememberDismissal(key: string): void {
  remembered.add(key);
  try {
    storage()?.setItem(DISMISSAL_PREFIX + key, new Date().toISOString());
  } catch {
    // Blocked or full: the in-memory set keeps it closed for this page.
  }
  for (const listener of [...listeners]) listener();
}

/** Forgets every dismissal made on this page. Tests use it; applications clear storage instead. */
export function resetDismissals(): void {
  remembered.clear();
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || isDismissalKey(event.key)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Whether the notice under `key` has been dismissed on this device: `false`
 * without a key, and `null` — not known yet — on the server and while
 * hydrating, because storage is only readable in the browser. A caller
 * renders nothing for `null`, so a banner somebody already closed never
 * flashes up on the next page load; one they have not closed appears as the
 * page hydrates.
 */
export function useDismissed(key: string | undefined): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? isDismissed(key) : false),
    () => (key ? null : false),
  );
}
