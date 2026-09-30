'use client';

import * as RadixPopover from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef, ReactNode, Ref, RefObject } from 'react';

export { Calendar } from '../overlays/Calendar.js';

export interface PopoverLayerProps extends Omit<ComponentPropsWithoutRef<typeof RadixPopover.Content>, 'asChild' | 'forceMount'> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The field the layer hangs from. Read by the positioning, never wrapped. */
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly ref?: Ref<HTMLDivElement>;
  readonly children?: ReactNode;
}

/**
 * The floating half of `Combobox` and `DatePicker`: the Radix popover —
 * portalled, positioned against the field, flipped when there is no room,
 * and part of the overlay layer stack, so Escape closes the list before the
 * dialog around it (SPEC §4.3) — and the calendar grid.
 *
 * Its own module so that it can be loaded *after* the field (see
 * `popover-layer.ts`). The popover library and its positioning engine are
 * about 25 kB, and a form that merely contains a date or a person picker —
 * the portal's catalogue item, whose route has the tightest budget of all —
 * should not pay for them until somebody reaches for one.
 *
 * The anchor is a `virtualRef`, not a wrapper. The field is drawn by the
 * control itself and this layer renders beside it; a wrapper arriving after
 * the field had mounted would remount the field under the person's caret.
 */
export function PopoverLayer({ open, onOpenChange, anchorRef, ref, children, ...content }: PopoverLayerProps): ReactNode {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Anchor virtualRef={anchorRef} />
      <RadixPopover.Portal>
        <RadixPopover.Content ref={ref} {...content}>
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
