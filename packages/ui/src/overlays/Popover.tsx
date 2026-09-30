'use client';

import * as RadixPopover from '@radix-ui/react-popover';
import { useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface PopoverProps {
  /** The element that opens it. It must forward its ref and spread props. */
  readonly trigger: ReactElement<{ id?: string }>;
  /** Makes the popover a dialog labelled by this title, shown as its heading. Without it, the trigger names it. */
  readonly title?: string;
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  /** `sm` 280 px, `md` 360 px (default), `lg` 480 px, or pixels. */
  readonly width?: 'sm' | 'md' | 'lg' | number;
  /** Traps focus and hides the page from assistive technology while open. Off by default. */
  readonly modal?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
}

/**
 * Anchored content that is not a menu: a filter's options, the *View only*
 * explanation, a date's calendar. On the Radix popover: collision-aware,
 * portalled, closed by Escape (as the top layer) or a press outside, focus
 * moved in on open and back to the trigger on close.
 *
 * It is a `dialog`. With `title` it is labelled by that heading; without,
 * by its trigger ("View only, dialog"), so it always has a name.
 *
 * `material.popover`, radius `xl`, elevation `lg`, scaling in from the
 * trigger's side over `fast` like a menu.
 */
export function Popover({ trigger, title, children, side = 'bottom', align = 'center', width = 'md', modal = false, open, onOpenChange, className }: PopoverProps): ReactNode {
  const generatedId = useId();
  const triggerId = trigger.props.id ?? `${generatedId}-trigger`;
  const titleId = `${generatedId}-title`;
  const style: CSSProperties | undefined = typeof width === 'number' ? { inlineSize: width } : undefined;

  return (
    <RadixPopover.Root modal={modal} {...(open === undefined ? {} : { open })} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild id={triggerId}>
        {trigger}
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          aria-labelledby={title ? titleId : triggerId}
          data-itsm-opener={triggerId}
          className={cx('itsm-Popover', typeof width === 'string' && `itsm-Popover--${width}`, className)}
          style={style}
        >
          {title ? (
            <h2 className="itsm-Popover__title" id={titleId}>
              {title}
            </h2>
          ) : null}
          <div className="itsm-Popover__body">{children}</div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
