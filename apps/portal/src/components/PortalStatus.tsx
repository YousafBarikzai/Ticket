'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { clearLocalData, needsAttention, outboxStore, pendingCount, registerServiceWorker, useOutbox, useServiceWorkerUpdate } from '@itsm/pwa';
import { useLiveState } from '@itsm/pwa/live';
import { ConnectionStatus, GlobalBanner, isDisclosureKey, isDismissalKey, isRecentsKey, notify, useItsm } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';

/**
 * The frame's connection and device state — loaded just after the page is
 * interactive, not in its first load (SPEC §3.7: the portal's first load is
 * budgeted, and none of this draws anything while all is well).
 *
 *   - `ServiceWorkerUpdates`: registers the service worker (the offline
 *     copies, the queued reports and replies) and says "A new version is
 *     ready · Reload" when a deploy lands mid-visit (F19). The worker waits
 *     for the person rather than taking over a page halfway through a report.
 *   - `ConnectionPill`: the top bar's `ConnectionStatus` — nothing when
 *     healthy; "Offline · 2 waiting", "Session ended", "1 didn't send" with
 *     its tray otherwise.
 *   - `ConnectionBanner`: "Your session ended · Sign in again", or "You're
 *     offline. This is the copy from 10:42." — what a page shows without a
 *     network is at least honest about its age.
 *   - `forgetThisDevice`: sign-out's first half — ask before discarding
 *     anything not yet sent, then clear the caches, the outbox, drafts,
 *     recents and dismissals (F19).
 *
 * Every page loads this module right after hydration (the service worker is
 * registered from it), so the pill and the banner are ready before anybody
 * could go offline, and the service worker keeps the chunk for next time.
 */

/* ------------------------------------------------------ Service worker */

export function ServiceWorkerUpdates(): null {
  const update = useServiceWorkerUpdate();

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!update.ready) return;
    notify('A new version is ready', {
      id: 'portal-update',
      tone: 'info',
      description: 'Reload when it suits you. Anything you were writing is kept.',
      duration: 'persistent',
      action: { label: 'Reload', onClick: update.apply },
    });
  }, [update.ready, update.apply]);

  return null;
}

/* ------------------------------------------------------------ The pill */

export interface ConnectionProps {
  /** The frame heard a 401 (a background read, or an action). The live stream's own `ended` is read here. */
  readonly sessionEnded: boolean;
  readonly onSignIn: () => void;
}

export function ConnectionPill({ sessionEnded, onSignIn }: ConnectionProps): ReactNode {
  const live = useLiveState();
  const outbox = useOutbox();
  const state = sessionEnded || live.state === 'ended' ? 'ended' : !outbox.online ? 'offline' : live.state;
  return (
    <ConnectionStatus
      state={state}
      pending={outbox.pending}
      attention={outbox.attention.map((item) => ({
        id: item.id,
        summary: item.summary,
        ...(item.problem ? { problem: item.problem } : {}),
        state: item.status === 'conflict' ? 'conflict' : 'failed',
      }))}
      onRetry={(id) => void outbox.retry(id)}
      onDiscard={(id) => void outbox.dismiss(id)}
      onSignIn={onSignIn}
    />
  );
}

/* ---------------------------------------------------------- The banner */

/** `navigator.onLine`, followed. */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** "10:42", or "Mon 29 Sept, 10:42" for a copy from another day. */
export function copyTimeLabel(iso: string, now: Date, locale: string, timeZone: string): string {
  const day = (value: Date | string): string => formatDateTime(value, { locale, timeZone, style: 'date' });
  return formatDateTime(iso, { locale, timeZone, style: day(iso) === day(now) ? 'time' : 'weekdayTime' });
}

export interface ConnectionBannerProps extends ConnectionProps {
  /** When the server drew the page on screen (ISO): the frame follows it across navigations. */
  readonly copyAt: string;
}

export function ConnectionBanner({ sessionEnded, onSignIn, copyAt }: ConnectionBannerProps): ReactNode {
  const { locale, timeZone } = useItsm();
  const live = useLiveState();
  const online = useOnline();

  if (sessionEnded || live.state === 'ended') {
    return (
      <GlobalBanner
        tone="warning"
        icon="log-in"
        title="Your session ended"
        body="Sign in again to carry on. Anything you were writing is kept on this device."
        action={{ id: 'sign-in', label: 'Sign in again' }}
        onAction={onSignIn}
        live="polite"
      />
    );
  }
  if (!online) {
    return (
      <GlobalBanner
        tone="neutral"
        icon="wifi-off"
        title="You’re offline"
        body={`This is the copy from ${copyTimeLabel(copyAt, new Date(), locale, timeZone)}. Reports, replies and approval decisions are kept and sent when you’re back.`}
        live="polite"
      />
    );
  }
  return null;
}

/* ------------------------------------------------------------ Sign-out */

/** What sign-out forgets on this device besides caches, the outbox and drafts: recents, dismissed notices, disclosure memory. */
export function isPersonalKey(key: string): boolean {
  return isRecentsKey(key) || isDismissalKey(key) || isDisclosureKey(key) || key.startsWith('itsm-portal-');
}

/**
 * Before the sign-out form posts: if anything is still waiting to send, ask
 * (`confirmDiscard` resolves the person's answer); then forget this device's
 * copies of the person's requests. Resolves false when they chose to stay.
 */
export async function forgetThisDevice(confirmDiscard: (count: number) => Promise<boolean>): Promise<boolean> {
  try {
    const items = await (await outboxStore()).all();
    const unsent = pendingCount(items) + needsAttention(items).length;
    if (unsent > 0 && !(await confirmDiscard(unsent))) return false;
  } catch {
    // An unreadable outbox has nothing to lose; sign out regardless.
  }
  await clearLocalData({ alsoKeys: isPersonalKey }).catch(() => undefined);
  return true;
}
