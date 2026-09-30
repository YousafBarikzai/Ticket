'use client';

import { useSyncExternalStore } from 'react';

function subscribe(change: () => void): () => void {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
}

/**
 * Whether the browser believes it is online — used only to say that a
 * setting cannot be changed until it is (profile changes never queue,
 * ADR-0043). The server render reads as online, so nothing is disabled
 * before the page has hydrated.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
