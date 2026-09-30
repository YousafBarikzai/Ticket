'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { newIdempotencyKey } from '@itsm/pwa';

/**
 * Small client pieces the request pages share.
 */

/** Asks the conversation's composer to open and take focus (the hero's Reply). */
export const OPEN_COMPOSER = 'app:open-composer';

export function openComposer(): void {
  window.dispatchEvent(new Event(OPEN_COMPOSER));
}

function subscribeOnline(change: () => void): () => void {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
}

/**
 * Whether the browser believes it is online — used only to say "Needs a
 * connection" on the moves that cannot queue (ADR-0043). It never decides
 * whether a message is sendable: the outbox tries, and queues on no answer.
 * The server render reads as online, so nothing is disabled before the
 * page has hydrated.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * One idempotency key per intent: the same words sent again (a retry after a
 * failure) carry the same key, so the API cannot take them twice; changed
 * words are a new intent with a new key. `settle()` forgets it once the
 * intent is done.
 */
export function useIntentKey(): { keyFor(body: string): string; settle(): void } {
  const intent = useRef<{ body: string; key: string } | null>(null);
  const keyFor = useCallback((body: string): string => {
    if (intent.current?.body !== body) intent.current = { body, key: newIdempotencyKey() };
    return intent.current.key;
  }, []);
  const settle = useCallback(() => {
    intent.current = null;
  }, []);
  return { keyFor, settle };
}
