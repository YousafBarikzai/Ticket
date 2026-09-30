'use client';

import { useSyncExternalStore } from 'react';

/**
 * The browser's offer to install the portal as an app (`beforeinstallprompt`),
 * kept for the profile's "Install the app".
 *
 * The browser fires the event once, soon after a document loads, and never
 * again on a client-side navigation. Listened for on the profile page alone,
 * it was missed whenever that page was reached through a link, which is how
 * people reach it. So the frame listens from its first load (`PortalProviders`
 * imports this module) and the profile reads what was kept.
 *
 * Taking the event (`preventDefault`) stops the browser's own install bar on
 * phones: the offer is made in Profile, once, in words.
 */

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function changed(next: InstallPromptEvent | null): void {
  offer = next;
  for (const listener of listeners) listener();
}

/** Starts listening (idempotent). Called when this module is first evaluated in a browser. */
let listening = false;
export function listenForInstallOffer(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    changed(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => changed(null));
}

listenForInstallOffer();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The kept offer, or null: none made, already used, or the app is installed. */
export function useInstallOffer(): InstallPromptEvent | null {
  return useSyncExternalStore(
    subscribe,
    () => offer,
    () => null,
  );
}

/** An offer can be shown once; after it has been, it is gone whatever the answer. */
export function spendInstallOffer(): void {
  changed(null);
}
