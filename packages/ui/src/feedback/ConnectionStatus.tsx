'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { announce } from '../a11y/announcer.js';
import { useIds } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import type { IconName } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { focusNearestOutside, holdsFocus } from './focus.js';
import { useComposedRef } from './refs.js';
import { Spinner } from './Spinner.js';

/** A queued write that needs the person: it failed, or it conflicts with a newer change. */
export interface ConnectionAttentionItem {
  readonly id: string;
  readonly summary: string;
  readonly problem?: string;
  readonly state: 'failed' | 'conflict';
}

export interface ConnectionStatusProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly state: 'live' | 'reconnecting' | 'offline' | 'ended';
  /** Writes waiting in the outbox. */
  readonly pending: number;
  /** Writes that did not go through and need a decision: try again, or discard. */
  readonly attention: readonly ConnectionAttentionItem[];
  /** Client only. */
  readonly onRetry: (id: string) => void;
  /** Client only. */
  readonly onDiscard: (id: string) => void;
  /** Client only. Offered in the tray when the session has ended. */
  readonly onSignIn?: () => void;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

type PillTone = 'neutral' | 'warning' | 'danger';

interface Summary {
  readonly healthy: boolean;
  readonly label: string;
  readonly tone: PillTone;
  /** An icon, or `null` for the spinner (reconnecting, sending). */
  readonly icon: IconName | null;
  readonly headline: string;
  readonly explanation?: string;
}

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

/**
 * What the pill and the tray say, from the three inputs. Healthy — live,
 * nothing waiting, nothing needing the person — is the normal case and shows
 * nothing at all (X-82). A write that failed or conflicts is never healthy,
 * even online: it is the one thing here a person has to act on.
 */
export function summariseConnection(state: ConnectionStatusProps['state'], pending: number, attention: number): Summary {
  const waiting = Math.max(0, Math.floor(pending));
  const parts: string[] = [];
  if (state === 'ended') parts.push('Session ended');
  else if (state === 'offline') parts.push('Offline');
  else if (state === 'reconnecting') parts.push('Reconnecting…');
  if (attention > 0) parts.push(`${attention} didn't send`);
  else if (waiting > 0) parts.push(state === 'live' ? `Sending ${waiting}…` : `${waiting} waiting`);

  const healthy = state === 'live' && waiting === 0 && attention === 0;
  const tone: PillTone = attention > 0 ? 'danger' : state === 'ended' ? 'warning' : 'neutral';
  const icon: IconName | null =
    attention > 0 ? 'circle-alert' : state === 'ended' ? 'log-in' : state === 'offline' ? 'wifi-off' : null;

  switch (state) {
    case 'ended':
      return {
        healthy,
        label: parts.join(' · '),
        tone,
        icon,
        headline: 'Your session ended',
        explanation: 'Sign in again to carry on. Anything waiting to send is kept on this device.',
      };
    case 'offline':
      return {
        healthy,
        label: parts.join(' · '),
        tone,
        icon,
        headline: "You're offline",
        explanation: "Changes that can wait are kept on this device and sent when you're back. Everything else needs a connection.",
      };
    case 'reconnecting':
      return {
        healthy,
        label: parts.join(' · '),
        tone,
        icon,
        headline: 'Reconnecting…',
        explanation: 'Live updates will resume in a moment. What you see may be a little out of date.',
      };
    default:
      return {
        healthy,
        label: parts.join(' · ') || 'Connected',
        tone,
        icon,
        headline: attention > 0 ? "Some changes didn't send" : waiting > 0 ? 'Sending your changes' : "Everything's sent",
      };
  }
}

/**
 * Speaks the changes that matter, once each: going offline, coming back, the
 * session ending, a write failing. Not "Reconnecting…", which is usually over
 * before it could be read out, and nothing on the first render — a page that
 * loads offline says so in its own banner.
 */
function useConnectionAnnouncements(state: ConnectionStatusProps['state'], pending: number, attention: number): void {
  const previous = useRef<{ state: ConnectionStatusProps['state']; attention: number } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { state, attention };
    if (!before) return;
    if (state !== before.state) {
      if (state === 'offline') announce("You're offline. Changes that can wait will be sent when you're back.");
      else if (state === 'ended') announce('Your session ended.');
      else if (state === 'live' && (before.state === 'offline' || before.state === 'reconnecting')) {
        announce(pending > 0 ? `Back online. Sending ${plural(pending, 'change', 'changes')}.` : 'Back online.');
      }
    }
    if (attention > before.attention) {
      const failed = attention - before.attention;
      announce(`${plural(failed, 'change', 'changes')} didn't send.`);
    }
  }, [state, pending, attention]);
}

/** Whether the browser has the Popover API, which draws the tray in the top layer (never clipped by the sidebar). */
function canPopover(element: HTMLElement): boolean {
  return typeof (element as { showPopover?: unknown }).showPopover === 'function';
}

interface Placement {
  readonly top: number;
  readonly left: number;
  readonly side: 'top' | 'bottom';
}

/** The ids one connection status needs, fixed so `useIds` can memoise them. */
const ID_PARTS = ['tray', 'title', 'failed'] as const;

const GAP = 8;
const MARGIN = 8;

/**
 * Connection and outbox state, in the shell's status slot (sidebar footer,
 * portal top bar, compact top bar) — never floating (SPEC §4.5).
 *
 * Healthy shows nothing at all (X-82). Otherwise a compact pill — "Offline ·
 * 2 waiting", "Reconnecting…", "Session ended", "1 didn't send" — with an
 * icon or spinner as well as words, that opens a tray: what the state means,
 * how much is waiting, and each write that did not go through with *Try
 * again* and *Discard*. Opening the tray puts focus on the first failed item
 * (X-51); Escape closes it and returns focus to the pill; so does a click
 * outside, without moving focus. Replaces the apps' `OfflineStatus` and the
 * drafts' `ConnectionPill`/`OutboxTray`.
 *
 * The tray is a non-modal dialog placed next to the pill, in the page's top
 * layer where the browser has the Popover API — so the sidebar's edge cannot
 * clip it — and as a fixed layer otherwise. It stays in the document right
 * after the pill, so Tab moves from the pill into it and on out of it.
 *
 * The pill is not a live region (the frame keeps `role=status` out of the
 * sidebar, SPEC §4.9); changes that matter are spoken once through the
 * shared announcer instead.
 */
export function ConnectionStatus({
  state,
  pending,
  attention,
  onRetry,
  onDiscard,
  onSignIn,
  className,
  ref,
  ...rest
}: ConnectionStatusProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const summary = summariseConnection(state, pending, attention.length);
  const ids = useIds('itsm-connection', ID_PARTS);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const composedRef = useComposedRef(rootRef, ref);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** The row whose button was used last, so focus can move to its neighbour when it leaves the list. */
  const lastRow = useRef<number | null>(null);

  useConnectionAnnouncements(state, pending, attention.length);

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setPlacement(null);
      if (!returnFocus) return;
      if (summary.healthy && rootRef.current) {
        // The pill is about to disappear with the tray; somewhere after it,
        // rather than the top of the page.
        focusNearestOutside(rootRef.current);
      } else {
        triggerRef.current?.focus();
      }
    },
    [summary.healthy],
  );

  // Place the tray against the pill: below it if it fits (the portal's top
  // bar), above it otherwise (the sidebar footer), kept inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const popover = canPopover(panel);
    if (popover) {
      try {
        (panel as HTMLElement & { showPopover(): void }).showPopover();
      } catch {
        // Already open, or detached mid-update: the fixed layer still shows it.
      }
    }
    const place = (): void => {
      const anchor = trigger.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const width = window.innerWidth;
      const height = window.innerHeight;
      const below = height - anchor.bottom;
      const side: Placement['side'] = below >= box.height + GAP + MARGIN || below >= anchor.top ? 'bottom' : 'top';
      const top = side === 'bottom' ? anchor.bottom + GAP : anchor.top - GAP - box.height;
      const rtl = getComputedStyle(trigger).direction === 'rtl';
      const start = rtl ? anchor.right - box.width : anchor.left;
      const left = Math.min(Math.max(MARGIN, start), Math.max(MARGIN, width - box.width - MARGIN));
      setPlacement({ top: Math.max(MARGIN, top), left, side });
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(panel);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      if (popover) {
        try {
          (panel as HTMLElement & { hidePopover(): void }).hidePopover();
        } catch {
          // Already closed.
        }
      }
    };
  }, [open]);

  // Opening moves focus into the tray: the first failed item's Try again if
  // there is one (X-51), else Sign in again, else the tray itself.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target =
      panel.querySelector<HTMLElement>('[data-connection-row] button') ??
      panel.querySelector<HTMLElement>('[data-connection-signin]') ??
      panel;
    target.focus();
    // Only on opening; the list changing under focus is handled below.
  }, [open]);

  // A row leaves the list once it has been retried or discarded, taking its
  // focused button with it. Focus moves to the row that took its place, the
  // one before it at the end of the list, or the tray.
  useEffect(() => {
    if (!open || lastRow.current === null) return;
    const panel = panelRef.current;
    if (!panel || holdsFocus(panel)) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const rows = panel.querySelectorAll<HTMLElement>('[data-connection-row]');
    const row = rows[Math.min(lastRow.current, rows.length - 1)];
    (row?.querySelector<HTMLElement>('button') ?? panel).focus();
    lastRow.current = null;
  }, [open, attention]);

  // Light dismiss: a press outside the pill and the tray closes it where the
  // press landed; focus leaving both (Tab past the last button) closes it too.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close]);

  if (summary.healthy && !open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Escape' || !open) return;
    // This layer only: a sheet or menu the pill sits in keeps its own Escape.
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  const panelStyle: CSSProperties | undefined = placement ? { top: placement.top, left: placement.left } : undefined;

  return (
    <span
      {...rest}
      ref={composedRef}
      className={cx('itsm-ConnectionStatus', className)}
      data-state={state}
      data-tone={summary.tone}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (open && next instanceof Node && rootRef.current && !rootRef.current.contains(next)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="itsm-ConnectionStatus__pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        {...(open ? { 'aria-controls': ids.tray } : {})}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {summary.icon ? <Icon name={summary.icon} size="xs" /> : <Spinner size="sm" className="itsm-ConnectionStatus__spinner" />}
        <span className="itsm-visually-hidden">Connection: </span>
        <span className="itsm-ConnectionStatus__label">{summary.label}</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={ids.tray}
          role="dialog"
          aria-modal="false"
          aria-labelledby={ids.title}
          tabIndex={-1}
          className="itsm-ConnectionStatus__tray"
          data-side={placement?.side}
          data-placed={placement ? '' : undefined}
          style={panelStyle}
          popover="manual"
        >
          <div className="itsm-ConnectionStatus__header">
            <h2 id={ids.title} className="itsm-ConnectionStatus__title">
              {summary.headline}
            </h2>
            {summary.explanation ? <p className="itsm-ConnectionStatus__explanation">{summary.explanation}</p> : null}
            {state === 'ended' && onSignIn ? (
              <Button variant="primary" size="sm" data-connection-signin="" onClick={onSignIn}>
                {messages.signInAgain}
              </Button>
            ) : null}
          </div>

          {pending > 0 ? (
            <p className="itsm-ConnectionStatus__pending">
              <Icon name="clock" size="sm" />
              {`${plural(pending, 'change', 'changes')} waiting to send`}
            </p>
          ) : null}

          {attention.length > 0 ? (
            <section className="itsm-ConnectionStatus__failed" aria-labelledby={ids.failed}>
              <h3 id={ids.failed} className="itsm-ConnectionStatus__failedTitle">
                Didn't send
              </h3>
              <ul className="itsm-ConnectionStatus__list">
                {attention.map((item, index) => (
                  <li key={item.id} className="itsm-ConnectionStatus__row" data-connection-row="" data-state={item.state}>
                    <div className="itsm-ConnectionStatus__rowText">
                      <p className="itsm-ConnectionStatus__summary">{item.summary}</p>
                      <p className="itsm-ConnectionStatus__problem">
                        {item.problem ?? (item.state === 'conflict' ? 'Someone else changed this first.' : "This couldn't be sent.")}
                      </p>
                    </div>
                    <div className="itsm-ConnectionStatus__rowActions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          lastRow.current = index;
                          onRetry(item.id);
                        }}
                      >
                        {messages.tryAgain}
                        <span className="itsm-visually-hidden">{`: ${item.summary}`}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          lastRow.current = index;
                          onDiscard(item.id);
                        }}
                      >
                        Discard
                        <span className="itsm-visually-hidden">{`: ${item.summary}`}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
