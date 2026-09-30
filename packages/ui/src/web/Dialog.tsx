'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { useFocusReturn } from '../overlays/focus-return.js';
import { InertOutside } from '../overlays/inert.js';
import { defaultMessages } from '../provider/messages.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from './cx.js';
import { IconButton } from './IconButton.js';

export type DialogCloseReason = 'escape' | 'scrim' | 'close-button' | 'programmatic';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: (reason: DialogCloseReason) => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** `sm` 400 px, `md` 560 px (default), `lg` 800 px. Below 768 px every size is a bottom sheet. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** Where focus lands. Defaults to the first focusable element — usually the close button. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** False for a dialog the user must answer, e.g. an unsaved-changes prompt. */
  readonly dismissible?: boolean;
  /** `alertdialog` for destructive confirmations: it is announced more assertively. */
  readonly role?: 'dialog' | 'alertdialog';
  readonly className?: string;
  /** The close button's name. Defaults to the provider's "Close dialog". */
  readonly closeLabel?: string;
}

/**
 * A modal dialog, hosted on Radix.
 *
 * Radix brings what a hand-built dialog kept getting subtly wrong: the layer
 * stack (Escape closes only the innermost overlay — a menu or a combobox list
 * opened inside the dialog closes first), `aria-hidden` on everything outside,
 * a focus scope that survives nested overlays, and a scroll lock that keeps
 * the scrollbar gutter.
 *
 * What stays in this component is what the product decided on top:
 *
 * - **Every dismissal names its reason** (`escape`, `scrim`, `close-button`),
 *   and a non-dismissible dialog ignores all three. Radix's own outside-press
 *   dismissal is switched off: only the scrim closes, and it closes on
 *   `pointerdown` so a drag that starts inside the dialog and ends outside is
 *   never read as "dismiss". Clicking a toast's *Undo* while a dialog is open
 *   does not close the dialog either.
 * - **Focus goes back synchronously** to the opener (`useFocusReturn`), not a
 *   task later as Radix would.
 * - **The page behind is `inert`**, not only `aria-hidden` (`InertOutside`),
 *   as behind a native modal dialog.
 * - **Opaque, never glass** (D6): `surface.overlay`, radius `3xl`, elevation
 *   `xl`, over a blurred scrim. Below 768 px it is a bottom sheet (X-96).
 *
 * The content is nested inside the scrim so a long dialog scrolls as one page
 * inside it, and so the scrim is the element that receives the press.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  dismissible = true,
  role = 'dialog',
  className,
  closeLabel,
}: DialogProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const contentRef = useRef<HTMLDivElement | null>(null);
  useFocusReturn(open, contentRef);

  const onScrimPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    // Only a press on the scrim itself; a press inside the dialog bubbles here too.
    if (event.target !== event.currentTarget || event.button !== 0) return;
    if (dismissible) onClose('scrim');
  };

  return (
    <RadixDialog.Root open={open}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="itsm-Dialog__scrim" onPointerDown={onScrimPointerDown}>
          <RadixDialog.Content
            ref={contentRef}
            role={role}
            aria-modal="true"
            className={cx('itsm-Dialog', `itsm-Dialog--${size}`, className)}
            onOpenAutoFocus={(event) => {
              const target = initialFocusRef?.current;
              if (!target) return;
              event.preventDefault();
              target.focus();
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              // Always prevented: Radix would close without a reason, and a
              // non-dismissible dialog must swallow Escape rather than pass it
              // to the page behind.
              event.preventDefault();
              if (dismissible) onClose('escape');
            }}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <div className="itsm-Dialog__header">
              <div className="itsm-Dialog__heading">
                <RadixDialog.Title className="itsm-Dialog__title">{title}</RadixDialog.Title>
                {description ? <RadixDialog.Description className="itsm-Dialog__description">{description}</RadixDialog.Description> : null}
              </div>
              {dismissible ? (
                <IconButton
                  className="itsm-Dialog__close"
                  label={closeLabel ?? messages.closeDialog}
                  icon="x"
                  size="sm"
                  variant="ghost"
                  onClick={() => onClose('close-button')}
                />
              ) : null}
            </div>
            <div className="itsm-Dialog__body">{children}</div>
            {footer ? <div className="itsm-Dialog__footer">{footer}</div> : null}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
        <InertOutside active={open} />
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
