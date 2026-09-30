'use client';

import { useSyncExternalStore } from 'react';

/**
 * One clock for every relative timestamp on the page.
 *
 * Fifty "3 min ago" labels on a ticket list must not start fifty timers, and
 * they must all move on together rather than one at a time. So there is one
 * interval, started by the first subscriber and stopped with the last, and
 * paused while the tab is hidden — a background tab re-rendering its
 * timestamps every half minute is battery spent on nobody. Coming back to the
 * tab ticks at once, so nothing reads "2 min ago" for a moment after an hour
 * away.
 *
 * Module-level rather than per provider: there is one wall clock, and a
 * timestamp rendered outside `ItsmProvider` (a test, a story) still ticks.
 */

/** How often relative times are refreshed. Half a minute keeps "N min ago" at most 30 s behind. */
export const CLOCK_INTERVAL_MS = 30_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  now = Date.now();
  for (const listener of [...listeners]) listener();
}

function start(): void {
  if (timer === null && listeners.size > 0) timer = setInterval(tick, CLOCK_INTERVAL_MS);
}

function stop(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    stop();
    return;
  }
  tick();
  start();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState !== 'hidden') start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

function getSnapshot(): number {
  // Nothing is subscribed until the first timestamp mounts, so the value can
  // be as old as the last unmount. Refresh it then — and only then, so that
  // repeated reads within one render agree, as React requires.
  if (timer === null && Date.now() - now >= CLOCK_INTERVAL_MS) now = Date.now();
  return now;
}

/** The server has no "now" to share with the browser; `null` tells the caller to render absolute time. */
function getServerSnapshot(): null {
  return null;
}

/**
 * The shared clock's current time in epoch milliseconds, or `null` while
 * rendering on the server and while hydrating.
 *
 * `null` during hydration is the point: the HTML was rendered without a
 * clock, so the first client render must be too, or React finds different
 * text and throws the server's HTML away. React re-renders with the real time
 * straight after — the "switch to relative after mount" SPEC §3.6 rule 8 asks
 * for — while a component mounted later, on a client navigation, gets the
 * time on its first render and never shows the absolute form at all.
 */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribe, getSnapshot, getServerSnapshot);
}
