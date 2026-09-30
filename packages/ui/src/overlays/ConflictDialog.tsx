'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { InlineAlert } from '../feedback/InlineAlert.js';
import { RelativeTime } from '../format/RelativeTime.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { Dialog } from '../web/Dialog.js';
import { problemText } from './problem-text.js';

/** One field someone else changed: "Jo changed Status: New → In progress · 2 min ago". */
export interface ConflictChange {
  readonly field: string;
  readonly theirs: string;
  readonly mine?: string;
  readonly by?: string;
  /** ISO 8601. */
  readonly at?: string;
}

export interface ConflictDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The thing being edited, e.g. "INC-000123". */
  readonly entityLabel: string;
  readonly changes: readonly ConflictChange[];
  /** Client only. */
  readonly onApplyMine: () => Promise<void>;
  /** Client only. */
  readonly onKeepTheirs: () => void;
  /** Offers one retry instead of the choice, e.g. "Retry status change" after a comment already posted. */
  readonly retryOnly?: { readonly label: string };
  readonly className?: string;
}

/**
 * A 409, explained (D15): what changed and who changed it, then *Apply my
 * change on top* or *Keep theirs*. Refetching is the caller's job. One
 * pattern for every entity edit in every app.
 *
 * An `alertdialog`, because it interrupts to ask a question; first focus is
 * *Keep theirs*, the choice that overwrites nobody's work. Applying runs
 * the caller's promise with the button busy; a failure stays in the dialog,
 * announced. `retryOnly` narrows the question to one retry when the rest of
 * what the person did has already been saved ("Retry status change").
 */
export function ConflictDialog({ open, onOpenChange, entityLabel, changes, onApplyMine, onKeepTheirs, retryOnly, className }: ConflictDialogProps): ReactNode {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPending(false);
  }, [open]);

  const apply = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onApplyMine();
      if (live.current) onOpenChange(false);
    } catch (failure) {
      if (live.current) setError(problemText(failure));
    } finally {
      if (live.current) setPending(false);
    }
  };

  const keepTheirs = (): void => {
    if (pending) return;
    onKeepTheirs();
    onOpenChange(false);
  };

  const title = `${entityLabel} changed while you were editing`;
  const description = retryOnly
    ? 'Someone else saved a change first. The rest of what you did was saved; this part was not.'
    : 'Someone else saved a change first. Choose which version to keep.';

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) keepTheirs();
      }}
      title={title}
      description={description}
      role="alertdialog"
      initialFocusRef={keepRef}
      className={cx('itsm-ConflictDialog', className)}
      footer={
        <>
          <Button ref={keepRef} variant="secondary" onClick={keepTheirs}>
            {retryOnly ? 'Don’t retry' : 'Keep theirs'}
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void apply()}>
            {retryOnly ? retryOnly.label : 'Apply my change on top'}
          </Button>
        </>
      }
    >
      {changes.length > 0 ? (
        <ul className="itsm-ConflictDialog__changes">
          {changes.map((change, index) => (
            <li key={`${change.field}-${index}`} className="itsm-ConflictDialog__change">
              <p className="itsm-ConflictDialog__summary">
                <span className="itsm-ConflictDialog__who">{change.by ?? 'Someone'}</span> changed{' '}
                <span className="itsm-ConflictDialog__field">{change.field}</span> to{' '}
                <span className="itsm-ConflictDialog__value">{change.theirs}</span>
                {change.at ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="itsm-visually-hidden">, </span>
                    <RelativeTime date={change.at} className="itsm-ConflictDialog__when" />
                  </>
                ) : null}
              </p>
              {change.mine !== undefined ? (
                <p className="itsm-ConflictDialog__mine">
                  Yours: <span className="itsm-ConflictDialog__value">{change.mine}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <div role="alert" className="itsm-ConflictDialog__error">
          <InlineAlert tone="danger">{error}</InlineAlert>
        </div>
      ) : null}
    </Dialog>
  );
}
