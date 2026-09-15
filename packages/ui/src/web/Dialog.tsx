import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { useFocusTrap } from '../a11y/focus-trap.js';
import { useIds } from '../a11y/ids.js';
import { IconButton } from './IconButton.js';

export type DialogCloseReason = 'escape' | 'scrim' | 'close-button' | 'programmatic';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: (reason: DialogCloseReason) => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  /** Where focus lands. Defaults to the first focusable element — usually the close button. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** False for a dialog the user must answer, e.g. an unsaved-changes prompt. */
  readonly dismissible?: boolean;
  /** `alertdialog` for destructive confirmations: it is announced more assertively. */
  readonly role?: 'dialog' | 'alertdialog';
  readonly className?: string;
}

/**
 * A modal dialog.
 *
 * Not the native `<dialog>` element: `showModal()` cannot be driven from React
 * state without the DOM and the virtual DOM disagreeing about whether the
 * dialog is open, and its behaviour still differs between engines. What the
 * native element gives us for free — a focus trap, inert background, Escape —
 * is provided here explicitly, and tested in `__tests__/dialog.test.ts`.
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
}: DialogProps): ReactNode {
  const ids = useIds('itsm-dialog', ['title', 'description'] as const);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(dialogRef, open, {
    initialFocus: () => initialFocusRef?.current ?? null,
  });

  // Escape is handled on the document in the capture phase so that it works
  // wherever focus happens to be, and stops before a parent overlay sees it.
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose('escape');
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, dismissible, onClose]);

  // The page behind a modal must not scroll: on touch devices it is otherwise
  // possible to scroll the background out from under the dialog.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="itsm-Dialog__scrim"
      onMouseDown={(event) => {
        // mousedown, not click: a drag that starts inside the dialog and ends
        // on the scrim must not be read as "dismiss".
        if (dismissible && event.target === event.currentTarget) onClose('scrim');
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={description ? ids.description : undefined}
        className={cx(`itsm-Dialog itsm-Dialog--${size}`, className)}
      >
        <div className="itsm-Dialog__header">
          <div style={{ flex: 1 }}>
            <h2 className="itsm-Dialog__title" id={ids.title}>
              {title}
            </h2>
            {description ? (
              <p className="itsm-Dialog__description" id={ids.description}>
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? <IconButton label="Close dialog" icon="✕" size="sm" onClick={() => onClose('close-button')} /> : null}
        </div>
        <div className="itsm-Dialog__body">{children}</div>
        {footer ? <div className="itsm-Dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
