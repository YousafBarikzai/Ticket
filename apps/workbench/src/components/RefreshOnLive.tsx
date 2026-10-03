'use client';

import { startTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLive } from '@itsm/pwa/live';

/**
 * Keeps a server-rendered dashboard current (A6 §3.6, SPEC §7.0.6).
 *
 * The Overview, Team performance and the war room are server components:
 * "current" means `router.refresh()`, which renders the page again on the
 * server and reconciles it in place, keeping focus, scroll and anything
 * typed. This island decides *when*, and draws nothing.
 *
 * - **A change** on the page's one live stream (a `ticket` notice by default),
 *   debounced: a burst of notices — a rule touching forty tickets — is one
 *   refresh, `debounceMs` after the last (10 s on the Overview, 5 s in the war
 *   room). A desk that never goes quiet still refreshes within `maxWaitMs` of
 *   the first notice it is holding, so the page cannot starve.
 * - **A reconnect**: notices may have been missed while the stream was down,
 *   so the page refreshes at once rather than assume nothing happened.
 * - **Coming back** to a tab that was hidden for more than `staleAfterMs`
 *   (60 s): what is on screen is that old.
 * - **Never while a dialog is open.** A refresh under an open dialog or sheet
 *   can change the facts somebody is acting on, mid-sentence. It waits, and
 *   happens once the dialog closes.
 *
 * `startTransition`, so the page stays interactive while the server works.
 */

export interface RefreshOnLiveProps {
  /** The notices that make the page stale. Default `ticket`. */
  readonly entity?: string | readonly string[];
  /** Topics this page needs beyond the frame's, e.g. a major incident's. */
  readonly topics?: readonly string[];
  /** Quiet time after the last notice before refreshing. Default 10 s (the Overview); the war room passes 5 s. */
  readonly debounceMs?: number;
  /** The longest a notice waits, however busy the stream. Default three times the debounce. */
  readonly maxWaitMs?: number;
  /** How long the tab must have been hidden for coming back to refresh. Default 60 s. */
  readonly staleAfterMs?: number;
  readonly enabled?: boolean;
}

export const REFRESH_DEBOUNCE_MS = 10_000;
export const REFRESH_STALE_AFTER_MS = 60_000;
/** How often a refresh held back by an open dialog checks whether it has closed. */
export const DIALOG_RECHECK_MS = 1_000;

/**
 * Whether a dialog is open: a modal or a sheet (`role="dialog"`,
 * `"alertdialog"`, `<dialog open>`) — the notification panel and a "Why?"
 * popover too, which are dialogs as well. Read at the moment of refreshing,
 * not tracked, so it costs nothing while nothing is pending.
 */
export function dialogOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') !== null;
}

export function RefreshOnLive({
  entity = 'ticket',
  topics,
  debounceMs = REFRESH_DEBOUNCE_MS,
  maxWaitMs = debounceMs * 3,
  staleAfterMs = REFRESH_STALE_AFTER_MS,
  enabled = true,
}: RefreshOnLiveProps): null {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the oldest notice not yet refreshed for arrived, for `maxWaitMs`. */
  const firstPending = useRef<number | null>(null);

  // The latest settings, read by the timers without re-subscribing to the stream.
  const settings = useRef({ debounceMs, maxWaitMs, router });
  settings.current = { debounceMs, maxWaitMs, router };

  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  /** Refreshes now — or, under an open dialog, as soon as it closes. */
  const fire = (): void => {
    clear();
    if (dialogOpen()) {
      timer.current = setTimeout(fire, DIALOG_RECHECK_MS);
      return;
    }
    firstPending.current = null;
    const { router: current } = settings.current;
    startTransition(() => current.refresh());
  };

  /** Arms the refresh `delay` from now, but never later than `maxWaitMs` after the first notice held. */
  const schedule = (delay: number): void => {
    const now = Date.now();
    firstPending.current ??= now;
    const latest = firstPending.current + settings.current.maxWaitMs - now;
    clear();
    timer.current = setTimeout(fire, Math.max(0, Math.min(delay, latest)));
  };

  useLive({
    entity,
    ...(topics ? { topics } : {}),
    onNotice: () => schedule(settings.current.debounceMs),
    onReconnect: () => schedule(0),
    enabled,
  });

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > staleAfterMs) schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // `schedule` reads refs only; the listener follows the settings that change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staleAfterMs]);

  // Nothing fires after the page has gone.
  useEffect(() => clear, []);

  return null;
}
