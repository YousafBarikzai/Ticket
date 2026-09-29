'use client';

import type { ReactNode } from 'react';
import type { ConfirmSpec } from '../types.js';
import { cx } from '../web/cx.js';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spec: ConfirmSpec;
  /** Client only. The dialog stays open, with the error inline, if this rejects. */
  readonly onConfirm: (reason?: string) => Promise<void>;
  readonly className?: string;
}

/**
 * Asks before an action that cannot be taken back. A danger confirmation is an
 * `alertdialog` whose initial focus is Cancel (X-69); it can require a reason,
 * a typed confirmation, and list what depends on the thing being changed.
 *
 * Stub (SPEC §4.3): renders the question while open; the overlays package
 * builds the dialog, its buttons and states.
 */
export function ConfirmDialog({ open, spec, className }: ConfirmDialogProps): ReactNode {
  if (!open) return null;
  return (
    <div
      role={spec.tone === 'danger' ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-label={spec.title}
      className={cx('itsm-ConfirmDialog', className)}
    >
      <h2>{spec.title}</h2>
      {spec.body ? <p>{spec.body}</p> : null}
    </div>
  );
}
