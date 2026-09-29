'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface NotificationItem {
  readonly id: string;
  readonly subject: string;
  readonly body?: string;
  readonly ticketId?: string;
  readonly eventType: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly readAt?: string | null;
}

export interface NotificationCenterProps {
  readonly unread: number;
  /** An SLA breach is waiting: a danger dot, pinned first, announced once. */
  readonly emergency?: boolean;
  /** Client only. */
  load(): Promise<{ items: NotificationItem[]; unread: number }>;
  /** Client only. */
  markRead(id: string | 'all'): Promise<void>;
  /** Client only. */
  hrefFor(item: NotificationItem): string;
  readonly emptyText?: string;
  readonly className?: string;
}

/**
 * The bell and its panel: server events, grouped by day, with unread dots and
 * "Mark all as read". A popover at md and up, a bottom sheet below.
 *
 * Stub (SPEC §4.9): renders the bell button with its count; the shell package
 * adds the panel.
 */
export function NotificationCenter({ unread, className }: NotificationCenterProps): ReactNode {
  return (
    <button type="button" className={cx('itsm-NotificationCenter', className)} aria-haspopup="dialog">
      {unread > 0 ? `Notifications, ${unread > 99 ? '99+' : unread} unread` : 'Notifications'}
    </button>
  );
}
