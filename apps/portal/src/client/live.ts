'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLive } from '@itsm/pwa/live';
import { announce } from '@itsm/ui';

/**
 * The portal's side of the live stream (SPEC D16, F18).
 *
 * `LiveProvider` in the frame holds the tab's one `EventSource`, on the
 * person's own `user:` topic (the API adds it; the portal asks for nothing
 * more). A requester hears about their own requests and their notifications
 * — enough to redraw a list or a request page the moment the desk replies,
 * with no polling.
 *
 * The portal's pages are server components, so "redraw" means
 * `router.refresh()`: the server renders the page again from the truth and
 * React reconciles it in place, keeping focus, scroll and anything typed.
 */

/** A burst of changes (a rule touching a request three times) is one refresh, a second after the last. */
export const REFRESH_SETTLE_MS = 1_000;

export interface LiveRefreshOptions {
  /** The entities whose notices redraw the page. Default `ticket`. */
  readonly entity?: string | readonly string[];
  /** Only notices about this one (a request's id). */
  readonly id?: string;
  /** Said once per refresh, politely: "New reply from the service desk". */
  readonly announcement?: string;
  readonly delayMs?: number;
  readonly enabled?: boolean;
}

/**
 * Redraws the page when something it shows changes, and after the stream
 * reconnects (anything could have changed while it was down). Debounced, and
 * inside a transition, so the current page stays interactive meanwhile.
 */
export function useLiveRefresh({ entity = 'ticket', id, announcement, delayMs = REFRESH_SETTLE_MS, enabled = true }: LiveRefreshOptions = {}): {
  readonly refreshing: boolean;
} {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const said = useRef(announcement);
  said.current = announcement;

  const schedule = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      startRefresh(() => router.refresh());
      if (said.current) announce(said.current);
    }, delayMs);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useLive({ entity, ...(id ? { id } : {}), onNotice: schedule, onReconnect: schedule, enabled });
  return { refreshing };
}

/**
 * The same, for a server component to drop into its tree:
 * `<LiveRefresh entity="ticket" id={ticket.id} announcement="…" />`.
 */
export function LiveRefresh(props: LiveRefreshOptions): null {
  useLiveRefresh(props);
  return null;
}
