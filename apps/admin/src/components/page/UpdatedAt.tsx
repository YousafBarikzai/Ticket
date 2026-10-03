'use client';

import { useCallback, useEffect, useRef, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { announce, IconButton, useItsm, useNow } from '@itsm/ui';
import { formatDateTime, formatRelative } from '@itsm/ui/format';
import { useRoutePending } from '@itsm/ui/shell';

/** Refresh by itself when the tab comes back after this long away… */
export const STALE_AFTER_MS = 60_000;
/** …and this often while it is in view. */
export const REFRESH_EVERY_MS = 5 * 60_000;

/** "Updated just now", "Updated 3 min ago"; the time of day before the clock is known (the server's render). */
export function updatedText(at: string, now: number | null, locale: string, timeZone: string): string {
  const moment = Date.parse(at);
  if (Number.isNaN(moment)) return 'Updated';
  if (now === null) return `Updated ${formatDateTime(at, { locale, timeZone, style: 'time' })}`;
  if (now - moment < 60_000) return 'Updated just now';
  return `Updated ${formatRelative(at, now, locale, { timeZone, style: 'short' })}`;
}

export interface UpdatedAtProps {
  /** When the page's data was read: the server render's instant. */
  readonly at: string;
  /** Said once when a refresh somebody asked for lands: "Command centre updated". */
  readonly announcement?: string;
  /** Turns off the quiet refreshes (on return and every five minutes); the button still works. */
  readonly auto?: boolean;
}

/**
 * "Updated 1 min ago ↻": how fresh the page is, and the way to make it fresher
 * (X-85). Moved from the Command centre into the page kit (A7 §2.3) so every
 * dashboard says it the same way.
 *
 * Refreshing re-renders the page's server data in a transition: what is on
 * screen stays until the new data is ready (no skeleton flash, v2 X-74), the
 * thin progress line runs if it is slow, and the announcement is said once
 * when a refresh somebody pressed lands. It also refreshes quietly when the
 * tab returns after a minute away, and every five minutes while it is visible
 * — never while hidden.
 */
export function UpdatedAt({ at, announcement = 'Page updated', auto = true }: UpdatedAtProps): ReactNode {
  const router = useRouter();
  const { locale, timeZone } = useItsm();
  const now = useNow();
  const [pending, startTransition] = useTransition();
  const asked = useRef(false);
  useRoutePending(pending);

  const refresh = useCallback(
    (byHand: boolean) => {
      asked.current = byHand;
      startTransition(() => router.refresh());
    },
    [router],
  );

  // Said once, when the refresh somebody pressed has landed (the new `at`).
  useEffect(() => {
    if (!asked.current || pending) return;
    asked.current = false;
    announce(announcement);
  }, [at, pending, announcement]);

  useEffect(() => {
    if (!auto) return undefined;
    const renderedAt = Date.parse(at);
    const stale = (): boolean => Date.now() - renderedAt >= STALE_AFTER_MS;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && stale()) refresh(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(false);
    }, REFRESH_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [at, auto, refresh]);

  return (
    <span className="app-Updated">
      <time dateTime={at} suppressHydrationWarning>
        {updatedText(at, now, locale, timeZone)}
      </time>
      <IconButton label="Refresh" icon="refresh-cw" size="sm" onClick={() => refresh(true)} aria-busy={pending || undefined} />
    </span>
  );
}
