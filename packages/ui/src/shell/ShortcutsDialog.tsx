'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
}

/**
 * Every registered shortcut, by group, with the switch that turns single-key
 * shortcuts off (and, in the workbench, live announcements). Opened by `?`
 * and from the account menu.
 *
 * Stub (SPEC §4.9): renders the heading while open; the shell package builds
 * the dialog from the hotkey registry.
 */
export function ShortcutsDialog({ open, className }: ShortcutsDialogProps): ReactNode {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className={cx('itsm-ShortcutsDialog', className)}>
      <h2>Keyboard shortcuts</h2>
    </div>
  );
}
