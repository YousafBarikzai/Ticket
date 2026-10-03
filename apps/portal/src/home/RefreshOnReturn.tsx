'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Home's service status, refreshed when the person comes back to the tab
 * (SPEC §6.3): the page is redrawn from the server — at most once a minute,
 * and never offline — because the status page sends no live notices to
 * requesters. It draws nothing; while the redraw is under way it marks the
 * status strip's region busy.
 *
 * Moved here from v2's "Good to know" card, which v3 replaces with server
 * parts (A6 §6.1); this is the one piece of it that has to run in the browser.
 */

/** A tab that comes back sooner than this is not asked again. */
export const REFRESH_EVERY_MS = 60_000;

export function RefreshOnReturn({ drawnAt, busyTarget }: { readonly drawnAt: string; readonly busyTarget?: string }): null {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const last = useRef(Date.parse(drawnAt) || Date.now());

  useEffect(() => {
    last.current = Date.parse(drawnAt) || Date.now();
  }, [drawnAt]);

  useEffect(() => {
    const onReturn = (): void => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (Date.now() - last.current < REFRESH_EVERY_MS) return;
      last.current = Date.now();
      startRefresh(() => router.refresh());
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [router]);

  useEffect(() => {
    const target = busyTarget ? document.getElementById(busyTarget) : null;
    if (!target) return;
    if (refreshing) target.setAttribute('aria-busy', 'true');
    else target.removeAttribute('aria-busy');
  }, [busyTarget, refreshing]);

  return null;
}
