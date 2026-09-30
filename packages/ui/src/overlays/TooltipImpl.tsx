'use client';

import * as RadixTooltip from '@radix-ui/react-tooltip';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Kbd } from '../web/Kbd.js';
import { cx } from '../web/cx.js';

/** Hover delay before a tooltip shows, and the window in which the next one shows at once (SPEC §4.3). */
export const TOOLTIP_DELAY_MS = 500;
export const TOOLTIP_SKIP_MS = 300;
/** How recently a navigation key must have been pressed for a focus to count as the person's. */
const KEYBOARD_FOCUS_WINDOW_MS = 1000;

export interface TooltipImplProps {
  readonly content: ReactNode;
  /** One focusable element that forwards its ref and spreads the props it is given. */
  readonly children: ReactElement;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  /** Shown as key caps after the text; the trigger should also carry `aria-keyshortcuts`. */
  readonly shortcut?: string;
  readonly delayMs?: number;
  /**
   * False when the tooltip text is already the trigger's name (`asLabel`):
   * describing a control with its own name makes a screen reader say it twice.
   */
  readonly describes?: boolean;
  readonly className?: string;
}

/* -------------------------------------------------------------------------
 * Page-wide memory: the skip window, and whether focus came from the keyboard.
 * ---------------------------------------------------------------------- */

let lastClosedAt = 0;
let lastNavigationKeyAt = 0;
let keyWatcherInstalled = false;

const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'F6']);

/**
 * Remembers when focus was last moved from the keyboard. A tooltip opens on
 * focus only then: a dialog focusing its first button as it opens, or a menu
 * handing focus back to its trigger, is the page moving focus, and a bubble
 * appearing over it is noise. (The same rule as `IconButton`'s tooltip.)
 */
function watchNavigationKeys(): void {
  if (keyWatcherInstalled || typeof document === 'undefined') return;
  keyWatcherInstalled = true;
  document.addEventListener(
    'keydown',
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) lastNavigationKeyAt = Date.now();
    },
    true,
  );
}

/**
 * The tooltip itself, on the Radix primitive: portalled above everything
 * (`z-index` tooltip), collision-aware, dismissed by Escape as the top layer
 * (so Escape closes the tooltip before the dialog it sits in), and hoverable
 * — the pointer can cross onto the bubble without it closing (WCAG 1.4.13).
 *
 * Radix's own open timing is switched off (`delayDuration` 0) and replaced
 * with the product's: 500 ms on hover, at once within 300 ms of another
 * tooltip closing, at once on a keyboard focus, never on a focus the page
 * made, never on touch (Radix ignores touch hovers and tap-focus already).
 */
export function TooltipImpl({
  content,
  children,
  side = 'top',
  shortcut,
  delayMs = TOOLTIP_DELAY_MS,
  describes = true,
  className,
}: TooltipImplProps): ReactNode {
  const [open, setOpen] = useState(false);
  const source = useRef<'pointer' | 'focus' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    watchNavigationKeys();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onOpenChange = (next: boolean): void => {
    cancel();
    if (!next) {
      if (open) lastClosedAt = Date.now();
      setOpen(false);
      return;
    }
    if (source.current === 'focus') {
      if (Date.now() - lastNavigationKeyAt <= KEYBOARD_FOCUS_WINDOW_MS) setOpen(true);
      return;
    }
    const wait = Date.now() - lastClosedAt <= TOOLTIP_SKIP_MS ? 0 : delayMs;
    if (wait === 0) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), wait);
  };

  const label = typeof content === 'string' ? content : undefined;

  return (
    <RadixTooltip.Provider delayDuration={0} skipDelayDuration={0}>
      <RadixTooltip.Root open={open} onOpenChange={onOpenChange} delayDuration={0}>
        <RadixTooltip.Trigger
          asChild
          onPointerMove={(event) => {
            if (event.pointerType !== 'touch') source.current = 'pointer';
          }}
          onPointerLeave={cancel}
          onPointerDown={cancel}
          onFocus={() => {
            source.current = 'focus';
          }}
          {...(describes ? {} : { 'aria-describedby': undefined })}
        >
          {children}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cx('itsm-Tooltip__content', className)}
            {...(label ? { 'aria-label': label } : {})}
          >
            <span className="itsm-Tooltip__text">{content}</span>
            {shortcut ? <Kbd keys={shortcut} size="sm" aria-hidden /> : null}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
