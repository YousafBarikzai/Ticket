'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

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
 * A 409, explained: what changed and who changed it, then *Apply my change on
 * top* or *Keep theirs*. Refetching is the caller's job. One pattern for every
 * entity edit in every app (D15).
 *
 * Stub (SPEC §4.3): renders the heading while open; the overlays package
 * builds the dialog.
 */
export function ConflictDialog({ open, entityLabel, className }: ConflictDialogProps): ReactNode {
  if (!open) return null;
  const title = `${entityLabel} changed while you were editing`;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className={cx('itsm-ConflictDialog', className)}>
      <h2>{title}</h2>
    </div>
  );
}
