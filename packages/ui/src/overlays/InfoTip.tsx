'use client';

import * as RadixPopover from '@radix-ui/react-popover';
import { useId, type ReactElement, type ReactNode } from 'react';
import { InfoTipButton, type InfoTipContent } from '../web/InfoTipTrigger.js';

export type { InfoTipContent } from '../web/InfoTipTrigger.js';

export interface InfoTipProps extends InfoTipContent {
  /** The button's accessible name, naming what it explains: "About Backlog". */
  readonly label: string;
  /** Which side of the button the bubble prefers; it flips when there is no room. `top` by default. */
  readonly side?: 'top' | 'bottom';
  /** For the button. */
  readonly className?: string;
  /**
   * A button to open it from in place of the default ⓘ. `InfoTipTrigger` hands
   * over the one it drew before this module loaded; it must forward its ref
   * and spread the props it is given.
   */
  readonly trigger?: ReactElement<{ id?: string }>;
  /** Controlled open state, with `onOpenChange`; uncontrolled without. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * The explanation behind an ⓘ, as a non-modal popover (v3 §2.14).
 *
 * A **toggletip**: a click or Enter opens it, a second click, Escape or a
 * press elsewhere closes it, and Escape puts focus back on the button. It is
 * a dialog named by its title (or, without one, by its button: "About
 * Backlog") and described by its body, so a screen reader that lands in it
 * hears the whole explanation. Nothing in it is interactive, and focus is not
 * trapped: Tab leaves it, and leaving closes it.
 *
 * `surface.inverse` with `text.inverse`, radius `md`, at most 300 px wide —
 * the tooltip's material, because it answers the same kind of question.
 *
 * Most pages want `InfoTipTrigger` from the root entry, which draws the button
 * at once and loads this module only when somebody reaches for it. This is the
 * eager form, for a client component that already carries the overlays.
 */
export function InfoTip({ label, title, body, source, side = 'top', className, trigger, open, onOpenChange }: InfoTipProps): ReactNode {
  const id = useId();
  const triggerId = trigger?.props.id ?? `${id}-trigger`;
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;

  return (
    <RadixPopover.Root modal={false} {...(open === undefined ? {} : { open })} {...(onOpenChange ? { onOpenChange } : {})}>
      <RadixPopover.Trigger asChild id={triggerId}>
        {trigger ?? <InfoTipButton label={label} className={className} />}
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align="center"
          sideOffset={6}
          collisionPadding={8}
          aria-labelledby={title ? titleId : triggerId}
          aria-describedby={bodyId}
          className="itsm-InfoTip"
        >
          {title ? (
            <p className="itsm-InfoTip__title" id={titleId}>
              {title}
            </p>
          ) : null}
          <p className="itsm-InfoTip__body" id={bodyId}>
            {body}
          </p>
          {source ? <p className="itsm-InfoTip__source">{source}</p> : null}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
