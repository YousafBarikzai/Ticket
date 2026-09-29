'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

/** What a failed submit hands back: messages per field, or one for the whole form. */
export interface FormSubmitResult {
  readonly fieldErrors?: Record<string, string>;
  readonly message?: string;
}

export interface FormAutosave {
  /** The draft's storage key, unique to the thing being edited. */
  readonly key: string;
  /** Default 5000. */
  readonly intervalMs?: number;
  /** Changes when the form's shape does, so an old draft is not restored into new fields. */
  readonly version?: string;
}

export interface FormProps {
  /** Client only. Resolves to nothing on success. */
  readonly onSubmit: (data: FormData) => Promise<void | FormSubmitResult>;
  readonly children: ReactNode;
  /** Keeps the actions visible at the bottom of a long form. */
  readonly stickyActions?: boolean;
  /** Asks before leaving with unsaved changes. */
  readonly dirtyGuard?: boolean;
  readonly autosave?: FormAutosave;
  /** mod+S submits. */
  readonly saveShortcut?: boolean;
  readonly className?: string;
}

/**
 * A form that knows how it failed: field errors are mapped onto their fields
 * and summarised in a focused `FormErrorSummary`, drafts can autosave and
 * restore, and leaving with unsaved changes asks first.
 *
 * Stub (SPEC §4.4): a native form that hands its `FormData` to `onSubmit`; the
 * forms package implements error mapping, the summary, autosave and guards.
 */
export function Form({ onSubmit, children, className }: FormProps): ReactNode {
  return (
    <form
      className={cx('itsm-Form', className)}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
    </form>
  );
}
