'use client';

import { useEffect, useSyncExternalStore } from 'react';

/*
 * Full-screen flows on phones — the "How can we help?" sheet, a catalogue
 * item's form, an approval — take the whole screen and bring their own Back
 * or Close, so the tab bar and the frame's bottom dock step aside while one
 * is showing (X-92). A count rather than a flag, so two nested flows do not
 * bring the tab bar back when the inner one closes.
 */

let active = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks a full-screen flow as showing while the caller is mounted (and `when` is true). */
export function useFullScreenFlow(when = true): void {
  useEffect(() => {
    if (!when) return;
    active += 1;
    emit();
    return () => {
      active -= 1;
      emit();
    };
  }, [when]);
}

/** Whether a full-screen flow is showing. False on the server. */
export function useFullScreenFlowActive(): boolean {
  return useSyncExternalStore(subscribe, () => active > 0, () => false);
}
