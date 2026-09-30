'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLive } from '@itsm/pwa/live';
import { deskKeys } from './query-client.js';

/**
 * The workbench's side of the live stream (SPEC D16, F18).
 *
 * `LiveProvider` in the frame holds the one `EventSource`; its topics are the
 * person's teams (`deskTopics` in `inbox/views.ts`, which the server layout
 * can call — this module is client-only).
 */

/** Counts are a glance, not a ticker: a burst of changes refreshes them once, at most every five seconds. */
export const COUNTS_SETTLE_MS = 5_000;

/**
 * Refreshes the sidebar counts when tickets change, and after a gap in the
 * stream (anything could have changed while it was down). Coalesced: a rule
 * that touches forty tickets is one refetch, not forty.
 */
export function useCountsFollowLive(): void {
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = (): void => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void client.invalidateQueries({ queryKey: deskKeys.counts() });
    }, COUNTS_SETTLE_MS);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useLive({ entity: 'ticket', onNotice: schedule, onReconnect: schedule });
}
