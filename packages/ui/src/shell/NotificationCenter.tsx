'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announce } from '../a11y/announcer.js';
import { formatBadgeCount } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { cx } from '../web/cx.js';
import { IconButton } from '../web/IconButton.js';
import { fetchModule, lazyModule, useIdlePrefetch } from './lazy.js';

/**
 * What a notification is about, which picks its tile (v3 §2.15): an SLA
 * warning is amber, a breach red, an approval the fuchsia of every wait, a
 * reply indigo, a major incident solid red; an assignment and anything else
 * take the product's own tint.
 */
export type NotificationKind = 'sla_warning' | 'breach' | 'approval' | 'reply' | 'major_incident' | 'assigned' | 'update';

export interface NotificationItem {
  readonly id: string;
  readonly subject: string;
  readonly body?: string;
  readonly ticketId?: string;
  /** The ticket's number ("INC-004101"), shown in the row's meta line; `ticketId` is the key a link is built from. */
  readonly ticketNumber?: string;
  readonly eventType: string;
  /** Overrides the kind worked out from `eventType`, for events whose type says nothing (imported samples). */
  readonly kind?: NotificationKind;
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
  /** The panel's footer link, "Notification settings": the portal's Profile, the desk's account settings. None without it. */
  readonly settingsHref?: string;
  readonly className?: string;
}

/** The event that makes a notification an emergency: an SLA breached on a ticket someone leads. */
export const EMERGENCY_EVENT = 'sla.breached.lead';

/** The panel, fetched on intent (it is built on the Radix popover and sheet). */
const panelModule = lazyModule(() => import('./NotificationPanel.js'));

/*
 * "Announced once": a page may draw two bells (the sidebar's and the compact
 * top bar's), and an emergency is news the first time, so the flag is shared.
 * It resets when every bell has seen the emergency clear, so the next breach
 * is announced too.
 */
let emergencyAnnounced = false;

/** For tests: forget that an emergency was announced. */
export function resetEmergencyAnnouncement(): void {
  emergencyAnnounced = false;
}

/**
 * The bell and its panel (v3 §2.15, X-M13): events from the server —
 * assignments, replies, approvals, SLA warnings and breaches, major
 * incidents — under "Today" and "Earlier", each row a link with a tile toned
 * by its kind, unread ones marked, with *Mark all read*. A 380 px popover at
 * 768 px and up; a sheet from the bottom below. The panel is its own chunk,
 * fetched on intent, so the bell costs the frame almost nothing.
 *
 * The count on the bell caps at "99+", and the bell's name carries it
 * ("Notifications, 3 unread"). An SLA breach on a ticket the person leads is
 * an emergency: a danger dot on the bell, the row first in its section, and
 * one assertive announcement — once, however many bells the page draws.
 *
 * Toasts are for the results of the person's own actions; everything else
 * the server has to say comes here.
 */
export function NotificationCenter({ unread, emergency = false, load, markRead, hrefFor, emptyText, settingsHref, className }: NotificationCenterProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const bell = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unread);
  const [Panel, setPanel] = useState<typeof import('./NotificationPanel.js')['NotificationPanel'] | null>(null);
  useIdlePrefetch(panelModule, itsm?.app === 'portal');

  // The parent's count (live from the server) wins whenever it changes.
  useEffect(() => setCount(unread), [unread]);

  useEffect(() => {
    if (!emergency) {
      emergencyAnnounced = false;
      return;
    }
    if (emergencyAnnounced) return;
    emergencyAnnounced = true;
    announce('Urgent: a service level has been breached on a ticket you lead. Open notifications to see it.', { politeness: 'assertive' });
  }, [emergency]);

  const prefetch = (): void => {
    if (Panel) return;
    fetchModule(panelModule).then(
      (module) => setPanel(() => module.NotificationPanel),
      // Offline or a replaced chunk: the bell stays a bell, and the next press tries again.
      () => setOpen(false),
    );
  };

  const toggle = (): void => {
    prefetch();
    setOpen((current) => !current);
  };

  const shown = count > 0 ? formatBadgeCount(count, false, itsm?.locale) : null;
  const label = [messages.notifications, shown ? `${shown} unread` : null, emergency ? 'urgent' : null].filter(Boolean).join(', ');

  return (
    <span className={cx('itsm-NotificationCenter', className)} data-emergency={emergency || undefined}>
      <IconButton
        ref={bell}
        icon="bell"
        variant="ghost"
        label={label}
        className="itsm-NotificationCenter__bell"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={toggle}
      />
      {shown ? (
        <span className="itsm-NotificationCenter__count" aria-hidden="true">
          {shown}
        </span>
      ) : null}
      {emergency ? <span className="itsm-NotificationCenter__urgent" aria-hidden="true" /> : null}
      {Panel ? (
        <Panel
          anchorRef={bell}
          open={open}
          onOpenChange={setOpen}
          load={load}
          markRead={markRead}
          hrefFor={hrefFor}
          unread={count}
          onUnreadChange={setCount}
          {...(emptyText ? { emptyText } : {})}
          {...(settingsHref ? { settingsHref } : {})}
        />
      ) : null}
    </span>
  );
}
