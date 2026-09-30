'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ProgressBar } from '../feedback/ProgressBar.js';
import { formatNumber } from '../format/format.js';
import { ConfirmDialog } from '../overlays/ConfirmDialog.js';
import { Menu, type MenuItemSpec } from '../overlays/Menu.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ActionSpec, Plural } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { IconButton } from '../web/IconButton.js';
import { nounFor } from './model.js';

/** Details a confirmed action carries back: the reason typed into the confirmation, when it asked for one. */
export interface ActionDetails {
  readonly reason?: string;
}

/**
 * A bulk action. With `menu` it is a menu of choices rather than one action
 * ("Status ▾": each state the selection can move to): the button opens the
 * menu, and behind "More" it becomes a submenu. The items act themselves
 * (`onSelect`); `onAction` is not called for them.
 */
export type BulkAction = ActionSpec & { readonly menu?: readonly MenuItemSpec[] };

export interface BulkActionBarProps {
  readonly count: number;
  readonly noun: Plural;
  /** More than three overflow to "More". */
  readonly actions: readonly BulkAction[];
  /**
   * Client only. An action with `confirm` is confirmed first; a promise keeps
   * the confirmation open, pending, until it settles.
   */
  readonly onAction: (id: string, details?: ActionDetails) => void | Promise<void>;
  readonly onClear: () => void;
  /** `float`: a capsule over the table (admin). `dock`: a bar at the bottom of the list pane (workbench). */
  readonly placement?: 'float' | 'dock';
  /** A long job's progress, with Cancel. */
  readonly busy?: { readonly label: string; readonly done?: number; readonly total?: number; onCancel?(): void };
  readonly className?: string;
}

/** Actions shown as buttons; the rest go behind "More". Three fit a phone-width capsule. */
const VISIBLE = 3;

/** One control in the toolbar, in visual order. */
type Slot =
  | { readonly kind: 'action'; readonly action: BulkAction }
  | { readonly kind: 'more' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'clear' };

/** Natively disabled, so out of the focus order: an action switched off with no reason to give. */
function unfocusable(slot: Slot): boolean {
  return slot.kind === 'action' && slot.action.disabled === true && !slot.action.disabledReason;
}

function menuItemFor(action: BulkAction, run: (action: ActionSpec) => void): MenuItemSpec {
  if (action.menu && !action.disabled) {
    return { type: 'submenu', id: action.id, label: action.label, ...(action.icon ? { icon: action.icon } : {}), items: action.menu };
  }
  return {
    id: action.id,
    label: action.label,
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.href ? { href: action.href } : {}),
    ...(action.shortcut ? { shortcut: action.shortcut } : {}),
    ...(action.tone ? { tone: action.tone } : {}),
    ...(action.disabled ? { disabled: true } : {}),
    ...(action.disabledReason ? { disabledReason: action.disabledReason } : {}),
    onSelect: () => run(action),
  };
}

/**
 * Actions for the selected rows, as a labelled toolbar: "Bulk actions for 3
 * selected tickets". Opaque, never glass (D6): it floats over rows, and text
 * on glass over text is unreadable.
 *
 * One tab stop, with ← → (Home, End) between its controls, as the APG toolbar
 * pattern has it. Up to three actions show as buttons; with more, two show
 * and the rest sit behind "More"; an action with a `menu` opens it ("Status
 * ▾"). A dangerous action keeps its colour, and one with a `confirm` asks
 * first. While a long job runs, the actions give way to its progress and a
 * Cancel button.
 */
export function BulkActionBar({ count, noun, actions, onAction, onClear, placement = 'float', busy, className }: BulkActionBarProps): ReactNode {
  const locale = useOptionalItsm()?.locale;
  const [confirming, setConfirming] = useState<ActionSpec | null>(null);
  // The last action confirmed stays mounted while its dialog animates closed.
  const [lastConfirmed, setLastConfirmed] = useState<ActionSpec | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  const selected = `${formatNumber(count, { locale })} selected ${nounFor(count, noun)}`;
  const inline = actions.length > VISIBLE ? actions.slice(0, VISIBLE - 1) : actions;
  const overflow = actions.length > VISIBLE ? actions.slice(VISIBLE - 1) : [];

  const run = (action: ActionSpec): void => {
    if (action.disabled) return;
    if (action.confirm) {
      setConfirming(action);
      setLastConfirmed(action);
      return;
    }
    // The caller reports a failure (a toast with the per-item results); here it only must not go unhandled.
    void Promise.resolve(onAction(action.id)).catch(() => undefined);
  };

  const slots: Slot[] = busy
    ? [...(busy.onCancel ? [{ kind: 'cancel' as const }] : []), { kind: 'clear' }]
    : [...inline.map((action) => ({ kind: 'action' as const, action })), ...(overflow.length > 0 ? [{ kind: 'more' as const }] : []), { kind: 'clear' }];
  // The tab stop, moved off a control that has gone or cannot take focus.
  const stop = slots[focusIndex] && !unfocusable(slots[focusIndex]!) ? focusIndex : slots.findIndex((slot) => !unfocusable(slot));
  const rove = (index: number) => ({
    'data-itsm-toolbar-item': index,
    tabIndex: index === stop ? (0 as const) : (-1 as const),
    onFocus: () => setFocusIndex(index),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!bar.current) return;
    const items = [...bar.current.querySelectorAll<HTMLElement>('[data-itsm-toolbar-item]')].filter((element) => !element.hasAttribute('disabled'));
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let next = -1;
    if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (current + 1) % items.length;
    else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    items[next]!.focus();
  };

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={`Bulk actions for ${selected}`}
      aria-orientation="horizontal"
      aria-busy={busy ? true : undefined}
      className={cx('itsm-BulkActionBar', className)}
      data-placement={placement}
      onKeyDown={onKeyDown}
    >
      <span className="itsm-BulkActionBar__count" aria-hidden="true">
        {formatNumber(count, { locale })} selected
      </span>
      <span className="itsm-BulkActionBar__actions">
        {busy ? (
          <ProgressBar
            className="itsm-BulkActionBar__progress"
            label={busy.total ? `${busy.label} ${formatNumber(busy.done ?? 0, { locale })} of ${formatNumber(busy.total, { locale })}` : busy.label}
            {...(busy.total ? { value: (busy.done ?? 0) / busy.total } : {})}
            size="sm"
          />
        ) : null}
        {slots.map((slot, index) => {
          switch (slot.kind) {
            case 'action': {
              const { action } = slot;
              const gated = action.disabled === true;
              if (action.menu && !gated) {
                return (
                  <Menu
                    key={action.id}
                    label={`${action.label} for ${selected}`}
                    side="top"
                    items={action.menu}
                    trigger={
                      <Button size="sm" variant={action.variant ?? 'ghost'} {...(action.icon ? { iconStart: action.icon } : {})} iconEnd="chevron-down" {...rove(index)}>
                        {action.label}
                      </Button>
                    }
                  />
                );
              }
              return (
                <Button
                  key={action.id}
                  size="sm"
                  variant={action.variant ?? (action.tone === 'danger' ? 'dangerTinted' : 'ghost')}
                  {...(action.icon ? { iconStart: action.icon } : {})}
                  {...(action.href && !gated ? { href: action.href, ...(action.external ? { external: true } : {}) } : {})}
                  {...(gated ? (action.disabledReason ? { disabledReason: action.disabledReason } : { disabled: true }) : {})}
                  {...(action.href && !gated ? {} : { onClick: () => run(action) })}
                  {...rove(index)}
                >
                  {action.label}
                </Button>
              );
            }
            case 'more':
              return (
                <Menu
                  key="more"
                  label={`More bulk actions for ${selected}`}
                  align="end"
                  side="top"
                  items={overflow.map((action) => menuItemFor(action, run))}
                  trigger={
                    <Button size="sm" variant="ghost" iconEnd="chevron-down" {...rove(index)}>
                      More
                    </Button>
                  }
                />
              );
            case 'cancel':
              return (
                <Button key="cancel" size="sm" variant="ghost" onClick={busy?.onCancel} {...rove(index)}>
                  Cancel
                </Button>
              );
            case 'clear':
              return (
                <IconButton
                  key="clear"
                  className="itsm-BulkActionBar__clear"
                  label="Clear selection"
                  icon="x"
                  size="sm"
                  variant="ghost"
                  onClick={onClear}
                  {...rove(index)}
                />
              );
          }
        })}
      </span>
      {lastConfirmed?.confirm ? (
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          spec={lastConfirmed.confirm}
          onConfirm={async (reason) => {
            await onAction(lastConfirmed.id, reason === undefined ? undefined : { reason });
          }}
        />
      ) : null}
    </div>
  );
}
