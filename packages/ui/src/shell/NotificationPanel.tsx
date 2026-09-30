'use client';

import * as RadixPopover from '@radix-ui/react-popover';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStableId } from '../a11y/ids.js';
import { formatDateTime } from '../format/format.js';
import { RelativeTime } from '../format/RelativeTime.js';
import { Icon } from '../icons/Icon.js';
import { MD_UP, useMediaQuery } from '../overlays/media.js';
import { Sheet } from '../overlays/Sheet.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { notify } from '../provider/notify.js';
import { Button } from '../web/Button.js';
import { EmptyState } from '../web/EmptyState.js';
import { EMERGENCY_EVENT, type NotificationItem } from './NotificationCenter.js';
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
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface DayGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NotificationItem[];
}

/** A calendar day in the reader's time zone, as a sortable key. */
function dayKey(iso: string | number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

function groupByDay(items: readonly NotificationItem[], locale: string, timeZone: string): DayGroup[] {
  const now = Date.now();
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(now - 86_400_000, timeZone);
  const groups = new Map<string, NotificationItem[]>();
  for (const item of items) {
    const key = dayKey(item.createdAt, timeZone);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDateTime(list[0]!.createdAt, { locale, timeZone, style: 'date' }),
    items: list,
  }));
}

function Row({ item, href, onFollow }: { readonly item: NotificationItem; readonly href: string; readonly onFollow: (item: NotificationItem) => void }): ReactNode {
  const unread = !item.readAt;
  const urgent = item.eventType === EMERGENCY_EVENT;
  return (
    <li className="itsm-NotificationPanel__entry">
      <ShellLink href={href} className="itsm-NotificationPanel__item" data-unread={unread || undefined} data-urgent={urgent || undefined} onClick={() => onFollow(item)}>
        <span className="itsm-NotificationPanel__marker" aria-hidden="true">
          {urgent ? <Icon name="triangle-alert" size="sm" /> : unread ? <span className="itsm-NotificationPanel__dot" /> : null}
        </span>
        <span className="itsm-NotificationPanel__text">
          <span className="itsm-NotificationPanel__subject">
            {urgent ? <span className="itsm-visually-hidden">Urgent: </span> : null}
            {item.subject}
          </span>
          {item.body ? <span className="itsm-NotificationPanel__body">{item.body}</span> : null}
          <RelativeTime date={item.createdAt} className="itsm-NotificationPanel__time" />
        </span>
        {unread ? <span className="itsm-visually-hidden">, unread</span> : null}
      </ShellLink>
    </li>
  );
}

function PanelBody({
  titleId,
  showTitle,
  items,
  state,
  unread,
  emptyText,
  onRetry,
  onMarkAll,
  onFollow,
  hrefFor,
}: {
  readonly titleId: string;
  readonly showTitle: boolean;
  readonly items: readonly NotificationItem[];
  readonly state: LoadState;
  readonly unread: number;
  readonly emptyText: string | undefined;
  readonly onRetry: () => void;
  readonly onMarkAll: () => void;
  readonly onFollow: (item: NotificationItem) => void;
  readonly hrefFor: (item: NotificationItem) => string;
}): ReactNode {
  const itsm = useOptionalItsm();
  const locale = itsm?.locale ?? 'en-GB';
  const timeZone = itsm?.timeZone ?? 'UTC';
  const urgent = items.filter((item) => item.eventType === EMERGENCY_EVENT && !item.readAt);
  const rest = items.filter((item) => !urgent.includes(item));
  const groups = groupByDay(rest, locale, timeZone);
  const first = state === 'loading' && items.length === 0;

  return (
    <div className="itsm-NotificationPanel" aria-busy={state === 'loading' || undefined}>
      <div className="itsm-NotificationPanel__header">
        {showTitle ? (
          <h2 className="itsm-NotificationPanel__title" id={titleId}>
            Notifications
          </h2>
        ) : null}
        {unread > 0 && items.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={onMarkAll} className="itsm-NotificationPanel__markAll">
            Mark all as read
          </Button>
        ) : null}
      </div>

      {state === 'error' && items.length === 0 ? (
        <div className="itsm-NotificationPanel__problem" role="alert">
          <Icon name="circle-alert" size="sm" />
          <span>Couldn’t load notifications.</span>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : first ? (
        <div className="itsm-NotificationPanel__skeleton">
          {[0, 1, 2].map((row) => (
            <div key={row} className="itsm-NotificationPanel__skeletonRow" aria-hidden="true">
              <span />
              <span />
            </div>
          ))}
          <span className="itsm-visually-hidden">Loading notifications…</span>
        </div>
      ) : items.length === 0 ? (
        <EmptyState size="sm" headingLevel={3} icon="bell" title={emptyText ?? 'You’re all caught up'} description="New assignments, mentions and approvals appear here." />
      ) : (
        <div className="itsm-NotificationPanel__groups">
          {urgent.length > 0 ? (
            <div className="itsm-NotificationPanel__group" data-urgent="">
              <h3 className="itsm-NotificationPanel__day">Needs attention</h3>
              <ul className="itsm-NotificationPanel__list">
                {urgent.map((item) => (
                  <Row key={item.id} item={item} href={hrefFor(item)} onFollow={onFollow} />
                ))}
              </ul>
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className="itsm-NotificationPanel__group">
              <h3 className="itsm-NotificationPanel__day">{group.label}</h3>
              <ul className="itsm-NotificationPanel__list">
                {group.items.map((item) => (
                  <Row key={item.id} item={item} href={hrefFor(item)} onFollow={onFollow} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {state === 'error' && items.length > 0 ? (
        <p className="itsm-NotificationPanel__stale" role="status">
          Couldn’t refresh — showing what was loaded before.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The notification panel, loaded by `NotificationCenter` on intent. A
 * non-modal popover anchored to the bell at 768 px and up (the bell stays the
 * one trigger, so nothing is redrawn under the pointer), a bottom sheet
 * below. Each opening refreshes the list while keeping what was there, so the
 * panel never flashes empty.
 */
export function NotificationPanel({ anchorRef, open, onOpenChange, load, markRead, hrefFor, unread, onUnreadChange, emptyText }: NotificationPanelProps): ReactNode {
  const titleId = useStableId('itsm-notifications-title');
  const wide = useMediaQuery(MD_UP, true);
  const [items, setItems] = useState<readonly NotificationItem[]>([]);
  const [state, setState] = useState<LoadState>('idle');
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

  const body = (showTitle: boolean): ReactNode => (
    <PanelBody
      titleId={titleId}
      showTitle={showTitle}
      items={items}
      state={state}
      unread={unread}
      emptyText={emptyText}
      onRetry={refresh}
      onMarkAll={onMarkAll}
      onFollow={onFollow}
      hrefFor={hrefFor}
    />
  );

  if (!wide) {
    return (
      <Sheet open={open} onOpenChange={(next) => onOpenChange(next)} side="bottom" size="md" title="Notifications" className="itsm-NotificationPanel__sheet">
        {body(false)}
      </Sheet>
    );
  }

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixPopover.Anchor virtualRef={anchorRef as RefObject<HTMLButtonElement>} />
      <RadixPopover.Portal>
        <RadixPopover.Content
          className="itsm-NotificationPanel__popover"
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
          {body(true)}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
