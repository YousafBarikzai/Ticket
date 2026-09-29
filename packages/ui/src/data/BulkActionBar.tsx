'use client';

import type { ReactNode } from 'react';
import type { ActionSpec, Plural } from '../types.js';
import { cx } from '../web/cx.js';

export interface BulkActionBarProps {
  readonly count: number;
  readonly noun: Plural;
  /** More than three overflow to "More". */
  readonly actions: readonly ActionSpec[];
  /** Client only. */
  readonly onAction: (id: string) => void;
  readonly onClear: () => void;
  /** `float`: a capsule over the table (admin). `dock`: a bar at the bottom of the list pane (workbench). */
  readonly placement?: 'float' | 'dock';
  /** A long job's progress, with Cancel. */
  readonly busy?: { readonly label: string; readonly done?: number; readonly total?: number; onCancel?(): void };
  readonly className?: string;
}

/**
 * Actions for the selected rows, as a labelled toolbar: "Bulk actions for 3
 * selected tickets". Opaque, never glass (D6).
 *
 * Stub (SPEC §4.7): renders the toolbar and its count; the data package adds
 * the actions, overflow and progress.
 */
export function BulkActionBar({ count, noun, placement = 'float', className }: BulkActionBarProps): ReactNode {
  const label = `Bulk actions for ${count} selected ${count === 1 ? noun.one : noun.other}`;
  return (
    <div role="toolbar" aria-label={label} className={cx('itsm-BulkActionBar', className)} data-placement={placement}>
      {`${count} selected`}
    </div>
  );
}
