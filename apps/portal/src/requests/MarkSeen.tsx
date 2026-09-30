'use client';

import { useEffect } from 'react';
import { api } from '../client/api.js';

/**
 * Marks this request's unread notifications as read once the person has
 * looked at it — so the unread dot on its row in My requests means "news
 * you haven't seen", and clears when they have. Again whenever the
 * conversation grows while the page is open.
 *
 * An effect, not part of the server render: a prefetch or a crawler must
 * never mark anything read. Quiet on failure — a dot that stays is not worth
 * an error.
 */
export function MarkSeen({ ticketId, messages }: { readonly ticketId: string; readonly messages: number }): null {
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const inbox = await api.notifications({ unread: true, limit: 100 });
        for (const notification of inbox.data) {
          if (stopped) return;
          if (notification.ticketId === ticketId && notification.readAt === null) await api.markNotificationRead(notification.id);
        }
      } catch {
        // Left unread; the bell still has it.
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ticketId, messages]);
  return null;
}
