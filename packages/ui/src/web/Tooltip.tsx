'use client';

import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';

export interface TooltipProps {
  /** Short, supplementary text. Anything the user must read to proceed belongs on the page. */
  readonly content: ReactNode;
  /** A single focusable element. The tooltip attaches `aria-describedby` to it. */
  readonly children: ReactElement<{ 'aria-describedby'?: string }>;
  readonly delayMs?: number;
  /** Set for a control whose only label is its icon; the tooltip then names it rather than describing it. */
  readonly asLabel?: boolean;
}

/**
 * A hover/focus tooltip meeting SC 1.4.13: dismissible with Escape, hoverable
 * (the bubble sits inside the hover target's wrapper, so moving onto it does
 * not dismiss it), and persistent until the pointer or focus leaves.
 */
export function Tooltip({ content, children, delayMs = 400, asLabel = false }: TooltipProps): ReactNode {
  const id = useStableId('itsm-tooltip');
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (immediate: boolean): void => {
    if (timer.current) clearTimeout(timer.current);
    // Keyboard focus shows it at once: a delay would make a keyboard user wait
    // for something a mouse user gets by hovering on the way past.
    if (immediate) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), delayMs);
  };

  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const trigger = cloneElement(children, {
    [asLabel ? 'aria-labelledby' : 'aria-describedby']: open ? id : undefined,
  } as { 'aria-describedby'?: string });

  return (
    <span
      className="itsm-Tooltip"
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {trigger}
      {open ? (
        <span role="tooltip" id={id} className="itsm-Tooltip__bubble">
          {content}
        </span>
      ) : null}
    </span>
  );
}
