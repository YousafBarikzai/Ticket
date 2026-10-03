'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLive } from '@itsm/pwa/live';
import type { NotificationItem } from '@itsm/ui/shell';
import { EMERGENCY_EVENT } from '@itsm/ui/shell';
import { api } from './api.js';

/**
 * The console's live layer: the bell and the connection (SPEC §4.10, ADR-0049
 * addendum).
 *
 * The console registers no service worker and queues nothing offline — an
 * administrator's change is not something to send later behind their back —
 * but it does share the product's one stream per tab (`@itsm/pwa/live`,
 * mounted in `Providers`). Nothing else in the console is live: pages show
 * "Updated 1 min ago" and refresh on demand, which is calmer for screens that
 * are read rather than worked.
 */

/* -------------------------------------------------------------------------
 * Online / offline
 * ---------------------------------------------------------------------- */

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/**
 * Whether the browser says it is online. True on the server and while
 * hydrating, so the first render matches the HTML; the banner appears after.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/* -------------------------------------------------------------------------
 * The bell
 * ---------------------------------------------------------------------- */

export interface AdminNotifications {
  readonly unread: number;
  /** An unread SLA breach warning: the bell shows its danger dot. */
  readonly emergency: boolean;
  load(): Promise<{ items: NotificationItem[]; unread: number }>;
  markRead(id: string | 'all'): Promise<void>;
  hrefFor(item: NotificationItem): string;
}

const PAGE_SIZE = 30;

function toItem(row: {
  id: string;
  subject: string | null;
  body: string;
  ticketId: string | null;
  eventType: string;
  createdAt: string;
  readAt: string | null;
}): NotificationItem {
  return {
    id: row.id,
    subject: row.subject ?? row.body.split('\n')[0] ?? 'Notification',
    ...(row.subject ? { body: row.body } : {}),
    ...(row.ticketId ? { ticketId: row.ticketId } : {}),
    eventType: row.eventType,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/**
 * Where a notification about a ticket opens (SPEC v3 §3.9, A2 §3.7).
 *
 * `serviceDeskTickets` is the Service Desk's ticket page as the area model
 * built it on the server — `crossAreaHref(areas, 'workbench', '/tickets/')`,
 * so this module never reads an origin or carries the area model's code —
 * and the ticket's key is appended as one path segment: tickets are worked
 * in the Service Desk, same tab. Without it (the person does not work
 * tickets, the Service Desk is not configured, or a demo visit, which cannot
 * tell whether Alex Morgan's teams can open the ticket, X-B2) the ticket
 * opens in this console's own register, drawer open.
 */
export function notificationHref(item: NotificationItem, serviceDeskTickets: string | null | undefined): string {
  const key = item.ticketNumber ?? item.ticketId;
  if (!key) return '/';
  if (serviceDeskTickets) return `${serviceDeskTickets}${encodeURIComponent(key)}`;
  return `/tickets?open=ticket:${encodeURIComponent(key)}`;
}

/**
 * The bell's data: the unread count from the API on mount, refreshed when the
 * stream says a notification arrived, when it reconnects (something may have
 * been missed) and when the tab comes back into view.
 */
export function useAdminNotifications(serviceDeskTickets?: string | null): AdminNotifications {
  const [unread, setUnread] = useState(0);
  const [emergency, setEmergency] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const inbox = await api.tenant.notifications({ unread: true, limit: PAGE_SIZE });
      setUnread(inbox.unread);
      setEmergency(inbox.data.some((row) => row.eventType === EMERGENCY_EVENT && row.readAt === null));
    } catch {
      // The bell is not worth an error of its own: it keeps what it last knew.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useLive({ entity: 'notification', onNotice: () => void refresh(), onReconnect: () => void refresh() });

  const load = useCallback(async () => {
    const inbox = await api.tenant.notifications({ limit: PAGE_SIZE });
    setUnread(inbox.unread);
    const items = inbox.data.map(toItem);
    setEmergency(items.some((item) => item.eventType === EMERGENCY_EVENT && !item.readAt));
    return { items, unread: inbox.unread };
  }, []);

  const markRead = useCallback(
    async (id: string | 'all') => {
      await api.tenant.markNotificationRead(id);
      await refresh();
    },
    [refresh],
  );

  const hrefFor = useCallback((item: NotificationItem) => notificationHref(item, serviceDeskTickets), [serviceDeskTickets]);

  return useMemo(() => ({ unread, emergency, load, markRead, hrefFor }), [unread, emergency, load, markRead, hrefFor]);
}
