'use client';

import type { PointerEvent, ReactNode, RefObject } from 'react';
import { AnchoredBubble } from './AnchoredBubble.js';
import { Kbd } from './Kbd.js';

export interface IconButtonTooltipProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly label: string;
  readonly shortcut?: string;
  readonly onPointerEnter?: (event: PointerEvent<HTMLSpanElement>) => void;
  readonly onPointerLeave?: (event: PointerEvent<HTMLSpanElement>) => void;
}

/**
 * The `IconButton` tooltip: the button's name and, when it has one, its
 * shortcut as key caps.
 *
 * A module of its own so that `IconButton` can load it with `React.lazy` the
 * first time somebody points at or tabs to an icon button (SPEC §3.1 rule 1):
 * a page nobody hovers never downloads it. The button owns the timing (delay,
 * grace period, Escape) so that nothing is lost while this file is on its
 * way; this only draws.
 *
 * Supplementary only. The button is already named (`aria-label`) and
 * announces its shortcut (`aria-keyshortcuts`), so the bubble is hidden from
 * assistive technology and the caps inside it are too.
 */
export function IconButtonTooltip({ anchorRef, open, label, shortcut, onPointerEnter, onPointerLeave }: IconButtonTooltipProps): ReactNode {
  return (
    <AnchoredBubble
      anchorRef={anchorRef}
      open={open}
      tone="tooltip"
      side="top"
      className="itsm-IconButton__tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <span>{label}</span>
      {shortcut ? <Kbd keys={shortcut} size="sm" aria-hidden /> : null}
    </AnchoredBubble>
  );
}
