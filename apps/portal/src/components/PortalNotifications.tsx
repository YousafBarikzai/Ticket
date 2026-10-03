'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type NotificationInbox, type NotificationRow } from '@itsm/sdk';
import { useLive } from '@itsm/pwa/live';
import { NotificationCenter, type NotificationItem } from '@itsm/ui/shell';
import { api } from '../client/api.js';
import { reportSessionEnded } from '../client/useAction.js';

/**
 * The bell (SPEC §4.9, C §3.11; v3 §2.15's `NotificationCenter`), live
 * through the frame's one stream.
 *
 * The count comes from the same call the panel lists: fetched when the frame
 * mounts, again whenever a `notification` notice arrives or the stream
 * reconnects, and when the tab comes back into view — so a reply from the
 * desk rings the bell within a second, with no polling. Each notification
 * about a request opens the request.
 *
 * No query library in the portal (its first load is budgeted): the inbox is
 * one piece of state, and a refetch that fails keeps the last good count
 * rather than dropping to zero. A 401 is the session ending in the
 * background, which the frame says once, in a banner.
 */

/** The panel shows the last 30; the badge counts every unread one. */
const PAGE = 30;

/** The panel's footer link, "Notification settings" (v3 §2.15): Profile's Notifications section. */
export const NOTIFICATION_SETTINGS_HREF = '/profile#notifications';

export function toNotificationItem(row: NotificationRow): NotificationItem {
  const subject = row.subject?.trim() || row.body.split('\n')[0]!.trim() || 'Notification';
  return {
    id: row.id,
    subject,
    ...(row.body && row.body.trim() !== subject ? { body: row.body } : {}),
    ...(row.ticketId ? { ticketId: row.ticketId } : {}),
    eventType: row.eventType,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/** A notification about a request opens the request; anything else, the list of them. */
export function notificationHref(item: Pick<NotificationItem, 'ticketId'>): string {
  return item.ticketId ? `/tickets/${encodeURIComponent(item.ticketId)}` : '/tickets';
}

export function PortalNotifications(): ReactNode {
  const [unread, setUnread] = useState(0);
  const inFlight = useRef<Promise<NotificationInbox> | null>(null);

  // One request at a time: a notice arriving mid-fetch reuses it.
  const fetchInbox = useCallback((): Promise<NotificationInbox> => {
    inFlight.current ??= api.notifications({ limit: PAGE }).finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  const refresh = useCallback(() => {
    fetchInbox().then(
      (inbox) => setUnread(inbox.unread),
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) reportSessionEnded('background');
      },
    );
  }, [fetchInbox]);

  useEffect(() => {
    refresh();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useLive({ entity: 'notification', onNotice: refresh, onReconnect: refresh });

  const load = useCallback(async () => {
    const inbox = await fetchInbox();
    setUnread(inbox.unread);
    return { items: inbox.data.map(toNotificationItem), unread: inbox.unread };
  }, [fetchInbox]);

  const markRead = useCallback(
    async (id: string) => {
      await api.markNotificationRead(id);
      refresh();
    },
    [refresh],
  );

  return (
    <NotificationCenter
      unread={unread}
      load={load}
      markRead={markRead}
      hrefFor={notificationHref}
      emptyText="You’re all caught up"
      settingsHref={NOTIFICATION_SETTINGS_HREF}
    />
  );
}
