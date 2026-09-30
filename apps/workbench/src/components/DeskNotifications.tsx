'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationInbox, NotificationRow } from '@itsm/sdk';
import { useLive } from '@itsm/pwa/live';
import { notify, useItsm } from '@itsm/ui';
import { EMERGENCY_EVENT, NotificationCenter, type NotificationItem } from '@itsm/ui/shell';
import { api } from '../client/api.js';
import { deskKeys } from '../client/query-client.js';

/**
 * The bell (SPEC §4.9, C §2.7), live through the frame's one stream.
 *
 * The badge's count comes from the same call the panel lists, fetched once
 * when the frame mounts and again whenever a `notification` notice arrives or
 * the stream reconnects — so a new assignment rings the bell within a second,
 * with no polling. An SLA breach on a ticket the person leads is an
 * emergency: a danger dot, pinned first in the panel, announced once, and a
 * persistent toast with *Open*, because it is the one notification that must
 * not wait for somebody to look at the sidebar.
 */

/** The panel shows the last 30; the badge counts every unread one. */
const PAGE = 30;

const key = deskKeys.notifications();

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

/** A notification about a ticket opens the ticket; anything else, the inbox. */
export function notificationHref(item: Pick<NotificationItem, 'ticketId'>): string {
  return item.ticketId ? `/tickets/${encodeURIComponent(item.ticketId)}` : '/inbox';
}

export function DeskNotifications(): ReactNode {
  const client = useQueryClient();
  const { router } = useItsm();

  const query = useQuery({
    queryKey: key,
    queryFn: (): Promise<NotificationInbox> => api.notifications({ limit: PAGE }),
    staleTime: 60_000,
  });

  const refresh = useCallback(() => void client.invalidateQueries({ queryKey: key }), [client]);
  useLive({ entity: 'notification', onNotice: refresh, onReconnect: refresh });

  const load = useCallback(async () => {
    const inbox = await client.fetchQuery({ queryKey: key, queryFn: () => api.notifications({ limit: PAGE }), staleTime: 0 });
    return { items: inbox.data.map(toNotificationItem), unread: inbox.unread };
  }, [client]);

  const markRead = useCallback(
    async (id: string) => {
      await api.markNotificationRead(id);
      await client.invalidateQueries({ queryKey: key });
    },
    [client],
  );

  const emergencies = useMemo(
    () => (query.data?.data ?? []).filter((row) => row.eventType === EMERGENCY_EVENT && !row.readAt),
    [query.data],
  );

  // One persistent toast per breach, the first time it is seen in this tab.
  const toasted = useRef(new Set<string>());
  useEffect(() => {
    for (const row of emergencies) {
      if (toasted.current.has(row.id)) continue;
      toasted.current.add(row.id);
      const item = toNotificationItem(row);
      notify(item.subject, {
        id: `emergency-${row.id}`,
        tone: 'danger',
        duration: 'persistent',
        ...(item.body ? { description: item.body } : {}),
        action: {
          label: 'Open',
          onClick: () => {
            void markRead(row.id).catch(() => undefined);
            router.push(notificationHref(item));
          },
        },
      });
    }
  }, [emergencies, markRead, router]);

  return (
    <NotificationCenter
      unread={query.data?.unread ?? 0}
      emergency={emergencies.length > 0}
      load={load}
      markRead={markRead}
      hrefFor={notificationHref}
      emptyText="You’re all caught up"
    />
  );
}
