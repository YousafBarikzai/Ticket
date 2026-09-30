'use client';

import { useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx.js';

export interface AnchoredBubbleProps {
  /**
   * The element the bubble points at. A ref rather than the element, read
   * when the bubble opens, so the control does not re-render after mounting
   * just to hand its own node over.
   */
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly open: boolean;
  /** Preferred side; the bubble flips when there is no room there. */
  readonly side?: 'top' | 'bottom';
  /** `tooltip`: a name and a shortcut. `note`: a sentence, such as why a button is unavailable. */
  readonly tone?: 'tooltip' | 'note';
  readonly id?: string;
  readonly className?: string;
  readonly onPointerEnter?: (event: PointerEvent<HTMLSpanElement>) => void;
  readonly onPointerLeave?: (event: PointerEvent<HTMLSpanElement>) => void;
  readonly children: ReactNode;
}

/** The gap between anchor and bubble, and the least distance kept from the viewport's edge, in CSS pixels. */
const GAP = 6;
const EDGE = 8;

/**
 * A small dark bubble beside a control: the `IconButton` tooltip and the
 * `Button` "why is this unavailable" note (X-80).
 *
 * In-house rather than a Radix tooltip for two reasons. The root entry stays
 * free of Radix (SPEC §3.1), and — the deeper one — the bubble renders as a
 * *sibling* of its control instead of wrapping it. A tooltip library wraps its
 * trigger, so adding one after the control has mounted (which is what loading
 * it on intent means) would remount the control under the pointer or the
 * keyboard focus: focus lost, a click swallowed halfway through.
 *
 * It sits in the top layer (`popover="manual"`) where the browser has it, so
 * no `overflow: hidden` card or stacking context clips it, and is placed with
 * fixed coordinates computed from the anchor — dynamic geometry, which is the
 * one thing inline style is allowed for (SPEC §3.3 rule 6). It follows the
 * anchor while the page scrolls.
 *
 * It is always `aria-hidden`: whatever it says is given to assistive
 * technology by the control itself (`aria-label`, `aria-keyshortcuts`,
 * `aria-describedby`), so a screen reader never hears it twice.
 */
export function AnchoredBubble({
  anchorRef,
  open,
  side = 'top',
  tone = 'tooltip',
  id,
  className,
  onPointerEnter,
  onPointerLeave,
  children,
}: AnchoredBubbleProps): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const bubble = ref.current;
    const anchor = anchorRef.current;
    if (!open || !anchor || !bubble) return;
    const view = bubble.ownerDocument.defaultView;
    if (!view) return;

    let promoted = false;
    if (typeof bubble.showPopover === 'function') {
      try {
        bubble.showPopover();
        promoted = true;
      } catch {
        // Refused (already shown, or detached for a frame). A `popover` that is
        // not showing is `display: none`, so drop the attribute and let fixed
        // positioning carry it.
        bubble.removeAttribute('popover');
      }
    }

    const place = (): void => {
      const target = anchor.getBoundingClientRect();
      const own = bubble.getBoundingClientRect();
      const width = view.document.documentElement.clientWidth || view.innerWidth;
      const height = view.document.documentElement.clientHeight || view.innerHeight;
      let placed = side;
      if (placed === 'top' && target.top - GAP - own.height < EDGE) placed = 'bottom';
      else if (placed === 'bottom' && target.bottom + GAP + own.height > height - EDGE && target.top - GAP - own.height >= EDGE) {
        placed = 'top';
      }
      const top = placed === 'top' ? target.top - GAP - own.height : target.bottom + GAP;
      const centred = target.left + target.width / 2 - own.width / 2;
      const left = Math.min(Math.max(centred, EDGE), Math.max(EDGE, width - EDGE - own.width));
      bubble.style.top = `${Math.round(top)}px`;
      bubble.style.left = `${Math.round(left)}px`;
      bubble.dataset.side = placed;
    };

    place();
    let frame = 0;
    const follow = (): void => {
      view.cancelAnimationFrame(frame);
      frame = view.requestAnimationFrame(place);
    };
    view.addEventListener('scroll', follow, { capture: true, passive: true });
    view.addEventListener('resize', follow, { passive: true });
    return () => {
      view.cancelAnimationFrame(frame);
      view.removeEventListener('scroll', follow, { capture: true });
      view.removeEventListener('resize', follow);
      if (promoted) {
        try {
          bubble.hidePopover();
        } catch {
          // Removed with its subtree already.
        }
      }
    };
  }, [open, anchorRef, side]);

  if (!open) return null;
  return (
    <span
      ref={ref}
      id={id}
      popover="manual"
      aria-hidden="true"
      className={cx('itsm-Bubble', className)}
      data-tone={tone}
      data-side={side}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </span>
  );
}
