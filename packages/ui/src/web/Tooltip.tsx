'use client';

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { TooltipImpl } from '../overlays/TooltipImpl.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';

export interface TooltipProps {
  /** Short, supplementary text. Anything the user must read to proceed belongs on the page. */
  readonly content: ReactNode;
  /** A single focusable element that forwards its ref and spreads the props it is given. */
  readonly children: ReactElement<{ 'aria-describedby'?: string; 'aria-label'?: string }>;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  /** A shortcut in the hotkey notation (`mod+k`), shown as key caps after the text. */
  readonly shortcut?: string;
  /** Hover delay; 500 ms, and none within 300 ms of another tooltip closing. */
  readonly delayMs?: number;
  /**
   * Set for a control whose only label is its icon: the text then names the
   * control (`aria-label`, always present) instead of describing it while
   * the bubble is up. Prefer `IconButton`, whose `label` is required.
   */
  readonly asLabel?: boolean;
  /** Turns this one off. The provider's `features.tooltips` turns them all off (the portal). */
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * A hover and keyboard-focus tooltip: `surface.inverse`, `footnote`, at most
 * 240 px wide, portalled above everything.
 *
 * Supplementary only (SPEC §4.3): never the only carrier of information,
 * never on touch, and off entirely where the provider says tooltips are off.
 * It meets WCAG 1.4.13 — Escape dismisses it without moving focus, the
 * pointer can move onto it, and it stays until the pointer or focus leaves.
 *
 * With `asLabel`, the child is named by the tooltip's text up front, so the
 * control has a name whether or not the bubble ever shows.
 */
export function Tooltip({ content, children, side, shortcut, delayMs, asLabel = false, disabled = false, className }: TooltipProps): ReactNode {
  const tooltipsOn = useOptionalItsm()?.features.tooltips ?? true;
  const named =
    asLabel && typeof content === 'string' && isValidElement(children) && !children.props['aria-label']
      ? cloneElement(children, { 'aria-label': content })
      : children;

  if (disabled || !tooltipsOn) return named;
  return (
    <TooltipImpl content={content} side={side} shortcut={shortcut} delayMs={delayMs} describes={!asLabel} className={className}>
      {named}
    </TooltipImpl>
  );
}
