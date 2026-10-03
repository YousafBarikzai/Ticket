'use client';

import * as RadixPopover from '@radix-ui/react-popover';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Count } from '../display/Count.js';
import { IconTile } from '../display/IconTile.js';
import { Banner } from '../feedback/Banner.js';
import { RelativeTime } from '../format/RelativeTime.js';
import { MD_UP, useMediaQuery } from '../overlays/media.js';
import { Sheet } from '../overlays/Sheet.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { notify } from '../provider/notify.js';
import type { IconName, Tone } from '../types.js';
import { Button } from '../web/Button.js';
import { EmptyState } from '../web/EmptyState.js';
import { Skeleton } from '../web/Skeleton.js';
import { EMERGENCY_EVENT, type NotificationItem, type NotificationKind } from './NotificationCenter.js';
import { ShellLink } from './ShellLink.js';

export interface NotificationPanelProps {
  readonly anchorRef: RefObject<HTMLButtonElement | null>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  load(): Promise<{ items: NotificationItem[]; unread: number }>;
  markRead(id: string | 'all'): Promise<void>;
  hrefFor(item: NotificationItem): string;
  readonly unread: number;
  readonly onUnreadChange: (unread: number) => void;
  readonly emptyText?: string;
  readonly settingsHref?: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * How long a first load may take before the panel shows its placeholder rows:
 * an answer inside it never flashes a skeleton (v3 §2.9, §2.15).
 */
export const NOTIFICATION_SKELETON_DELAY_MS = 200;

/** Placeholder rows while the first load is slow. */
const SKELETON_ROWS = 3;

/** A kind's tile: its tone and glyph, and whether it is the one solid tile (a major incident). */
interface KindLook {
  readonly tone: 'accent' | Tone;
  readonly icon: IconName;
  readonly solid?: true;
}

const KIND_LOOK: Readonly<Record<NotificationKind, KindLook>> = {
  sla_warning: { tone: 'warning', icon: 'clock' },
  breach: { tone: 'danger', icon: 'circle-alert' },
  approval: { tone: 'hold', icon: 'hourglass' },
  reply: { tone: 'info', icon: 'message-circle' },
  major_incident: { tone: 'danger', icon: 'siren', solid: true },
  assigned: { tone: 'accent', icon: 'user-plus' },
  update: { tone: 'accent', icon: 'bell' },
};

/**
 * What a notification is about, from its event type unless the item says.
 * Read by prefix and keyword rather than a closed list, because the event
 * types belong to the modules that publish them: `sla.timer.warning`,
 * `sla.timer.breached` and the lead's `sla.breached.lead`,
 * `approval.requested`, `ticket.comment.added`, `incident.major.declared`.
 */
export function notificationKind(item: Pick<NotificationItem, 'eventType' | 'kind'>): NotificationKind {
  if (item.kind) return item.kind;
  const type = item.eventType.toLowerCase();
  if (type.startsWith('sla.')) {
    if (type.includes('breach')) return 'breach';
    if (type.includes('warning') || type.includes('risk')) return 'sla_warning';
  }
  if (type.startsWith('approval.') || type.startsWith('approvals.')) return 'approval';
  if (/(?:^|\.)(?:major|major_incident|major-incident)(?:\.|$)/.test(type)) return 'major_incident';
  if (type.startsWith('ticket.comment') || type.includes('reply') || type.includes('replied')) return 'reply';
  if (type === 'ticket.assigned' || type.endsWith('.assigned')) return 'assigned';
  return 'update';
}

/** A calendar day in the reader's time zone, as a sortable key. */
function dayKey(at: string | number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** An unread breach on a ticket the person leads: first in its section, said first in its name. */
const isEmergency = (item: NotificationItem): boolean => item.eventType === EMERGENCY_EVENT && !item.readAt;

export interface NotificationSection {
  readonly key: 'today' | 'earlier';
  readonly label: 'Today' | 'Earlier';
  readonly items: readonly NotificationItem[];
}

/**
 * "Today" and "Earlier", by the reader's calendar day; empty sections are
 * left out. Each keeps the server's order (newest first), except that an
 * unread emergency leads its section, so the row the bell is shouting about
 * is the first one a person reaches there.
 */
export function sectionsOf(items: readonly NotificationItem[], timeZone: string, now: number = Date.now()): NotificationSection[] {
  const today = dayKey(now, timeZone);
  const lead = (list: NotificationItem[]): NotificationItem[] => [...list.filter(isEmergency), ...list.filter((item) => !isEmergency(item))];
  const todays: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  for (const item of items) (dayKey(item.createdAt, timeZone) === today ? todays : earlier).push(item);
  const sections: NotificationSection[] = [];
  if (todays.length > 0) sections.push({ key: 'today', label: 'Today', items: lead(todays) });
  if (earlier.length > 0) sections.push({ key: 'earlier', label: 'Earlier', items: lead(earlier) });
  return sections;
}

function Row({ item, href, onFollow }: { readonly item: NotificationItem; readonly href: string; readonly onFollow: (item: NotificationItem) => void }): ReactNode {
  const unread = !item.readAt;
  const kind = notificationKind(item);
  const look = KIND_LOOK[kind];
  const urgent = isEmergency(item);
  return (
    <li className="itsm-NotificationPanel__entry">
      <ShellLink href={href} className="itsm-NotificationPanel__item" data-kind={kind} data-unread={unread || undefined} onClick={() => onFollow(item)}>
        <IconTile icon={look.icon} tone={look.tone} size={28} className="itsm-NotificationPanel__tile" data-solid={look.solid ? '' : undefined} />
        <span className="itsm-NotificationPanel__text">
          <span className="itsm-NotificationPanel__subject">
            {urgent ? <span className="itsm-visually-hidden">Urgent: </span> : null}
            {item.subject}
          </span>
          {/* The two lines are spans; a screen reader hears the break as a comma. */}
          <span className="itsm-visually-hidden">, </span>
          <span className="itsm-NotificationPanel__meta">
            {item.ticketNumber ? (
              <>
                <span className="itsm-NotificationPanel__ref">{item.ticketNumber}</span>
                <span aria-hidden="true"> · </span>
                <span className="itsm-visually-hidden">, </span>
              </>
            ) : null}
            <RelativeTime date={item.createdAt} className="itsm-NotificationPanel__time" />
          </span>
        </span>
        {unread ? (
          <>
            <span className="itsm-NotificationPanel__dot" aria-hidden="true" />
            <span className="itsm-visually-hidden">, unread</span>
          </>
        ) : null}
      </ShellLink>
    </li>
  );
}

/** Three rows the shape of the real ones — a tile and two lines — while a first load is slow. */
function SkeletonRows(): ReactNode {
  return (
    <ul className="itsm-NotificationPanel__list itsm-NotificationPanel__skeleton" aria-busy="true" aria-label="Loading notifications">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <li key={index} className="itsm-NotificationPanel__skeletonRow" aria-hidden="true">
          <Skeleton width={28} height={28} radius="md" />
          <span className="itsm-NotificationPanel__skeletonText">
            <Skeleton width={['72%', '56%', '64%'][index]!} height={12} />
            <Skeleton width={['36%', '44%', '28%'][index]!} height={10} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface BodyProps {
  /** Prefixes the section headings' ids, so two panels on a page never share one. */
  readonly idPrefix: string;
  readonly items: readonly NotificationItem[];
  readonly state: LoadState;
  readonly slow: boolean;
  readonly emptyText: string | undefined;
  readonly settingsHref: string | undefined;
  readonly onRetry: () => void;
  readonly onFollow: (item: NotificationItem) => void;
  readonly onSettings: () => void;
  readonly hrefFor: (item: NotificationItem) => string;
}

function PanelBody({ idPrefix, items, state, slow, emptyText, settingsHref, onRetry, onFollow, onSettings, hrefFor }: BodyProps): ReactNode {
  const timeZone = useOptionalItsm()?.timeZone ?? 'UTC';
  const failed = state === 'error';
  const waiting = state === 'loading' && items.length === 0;

  let content: ReactNode;
  if (waiting) {
    content = slow ? <SkeletonRows /> : null;
  } else if (items.length === 0 && !failed) {
    content = <EmptyState size="sm" tone="success" headingLevel={3} title={emptyText ?? 'You’re all caught up'} className="itsm-NotificationPanel__empty" />;
  } else if (items.length > 0) {
    content = (
      <div className="itsm-NotificationPanel__sections">
        {sectionsOf(items, timeZone).map((section) => (
          <div key={section.key} className="itsm-NotificationPanel__section">
            <h3 className="itsm-NotificationPanel__day" id={`${idPrefix}-${section.key}`}>
              {section.label}
            </h3>
            <ul className="itsm-NotificationPanel__list" aria-labelledby={`${idPrefix}-${section.key}`}>
              {section.items.map((item) => (
                <Row key={item.id} item={item} href={hrefFor(item)} onFollow={onFollow} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="itsm-NotificationPanel__body">
      {failed ? (
        <Banner tone="danger" title="Couldn’t load notifications" action={{ id: 'retry', label: 'Retry' }} onAction={onRetry} className="itsm-NotificationPanel__problem">
          {items.length > 0 ? 'Showing what was loaded before.' : undefined}
        </Banner>
      ) : null}
      {content}
      {settingsHref ? (
        <div className="itsm-NotificationPanel__footer">
          <ShellLink href={settingsHref} className="itsm-NotificationPanel__settings" onClick={onSettings}>
            Notification settings
          </ShellLink>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The notification panel (v3 §2.15), loaded by `NotificationCenter` on
 * intent. A non-modal popover anchored to the bell at 768 px and up (the bell
 * stays the one trigger, so nothing is redrawn under the pointer), a sheet
 * from the bottom below.
 *
 * - **Header:** "Notifications" with the unread `Count` in the heading (so
 *   the dialog is named "Notifications, 3 unread") and *Mark all read*, which
 *   is hidden while the list cannot be trusted (an error).
 * - **Rows:** links, 56 px: a 28 px tile toned by kind, the subject (semibold
 *   while unread), a meta line with the ticket number in the `id` style and
 *   the relative time, and a 6 px accent dot — with ", unread" in the link's
 *   name, so the dot is never the only cue.
 * - **States:** each opening refreshes the list and keeps what was there, so
 *   the panel never flashes empty. A first load still pending after 200 ms
 *   shows three placeholder rows on a busy list; a failure is a danger
 *   banner with *Retry*; nothing at all is "You're all caught up".
 */
export function NotificationPanel({ anchorRef, open, onOpenChange, load, markRead, hrefFor, unread, onUnreadChange, emptyText, settingsHref }: NotificationPanelProps): ReactNode {
  const titleId = useStableId('itsm-notifications-title');
  const wide = useMediaQuery(MD_UP, true);
  const locale = useOptionalItsm()?.locale ?? 'en-GB';
  const [items, setItems] = useState<readonly NotificationItem[]>([]);
  const [state, setState] = useState<LoadState>('idle');
  const [slow, setSlow] = useState(false);
  const request = useRef(0);

  const refresh = useCallback(() => {
    const ticket = ++request.current;
    setState('loading');
    load().then(
      (result) => {
        if (ticket !== request.current) return;
        setItems(result.items);
        setState('ready');
        onUnreadChange(result.unread);
      },
      () => {
        if (ticket === request.current) setState('error');
      },
    );
  }, [load, onUnreadChange]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // The placeholder waits: a load that answers within the delay never shows it.
  useEffect(() => {
    if (state !== 'loading') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), NOTIFICATION_SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const onMarkAll = (): void => {
    const before = items;
    const readAt = new Date().toISOString();
    setItems(items.map((item) => (item.readAt ? item : { ...item, readAt })));
    onUnreadChange(0);
    markRead('all').catch(() => {
      setItems(before);
      onUnreadChange(unread);
      notify('Couldn’t mark notifications as read', { tone: 'danger' });
    });
  };

  const onFollow = (item: NotificationItem): void => {
    if (!item.readAt) {
      onUnreadChange(Math.max(0, unread - 1));
      markRead(item.id).catch(() => undefined);
    }
    onOpenChange(false);
  };

  const count = <Count value={unread > 0 ? unread : null} label="unread" locale={locale} className="itsm-NotificationPanel__count" />;
  const markAll =
    unread > 0 && items.length > 0 && state !== 'error' ? (
      <Button size="sm" variant="ghost" onClick={onMarkAll} className="itsm-NotificationPanel__markAll">
        Mark all read
      </Button>
    ) : null;
  const body = (
    <PanelBody
      idPrefix={titleId}
      items={items}
      state={state}
      slow={slow}
      emptyText={emptyText}
      settingsHref={settingsHref}
      onRetry={refresh}
      onFollow={onFollow}
      onSettings={() => onOpenChange(false)}
      hrefFor={hrefFor}
    />
  );

  if (!wide) {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => onOpenChange(next)}
        side="bottom"
        size="md"
        title="Notifications"
        headerMeta={count}
        {...(markAll ? { headerActions: markAll } : {})}
        className="itsm-NotificationPanel itsm-NotificationPanel__sheet"
      >
        {body}
      </Sheet>
    );
  }

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixPopover.Anchor virtualRef={anchorRef as RefObject<HTMLButtonElement>} />
      <RadixPopover.Portal>
        <RadixPopover.Content
          className="itsm-NotificationPanel itsm-NotificationPanel__popover"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          aria-labelledby={titleId}
          onCloseAutoFocus={(event) => {
            // There is no Radix trigger (the bell is ours), so focus goes back by hand.
            event.preventDefault();
            anchorRef.current?.focus();
          }}
          onInteractOutside={(event) => {
            // A press on the bell toggles it; let the bell do that rather than close-then-reopen.
            const target = event.target;
            if (target instanceof Node && anchorRef.current?.contains(target)) event.preventDefault();
          }}
        >
          <div className="itsm-NotificationPanel__header">
            <h2 className="itsm-NotificationPanel__title" id={titleId}>
              Notifications
              {count}
            </h2>
            {markAll}
          </div>
          {body}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
