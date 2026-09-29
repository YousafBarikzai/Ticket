'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface InlineEditOption {
  readonly value: string;
  readonly label: string;
}

/** What a save resolves to: nothing on success, a message, or someone else's newer value. */
export type InlineEditResult = void | { readonly error: string } | { readonly conflict: { readonly theirs: string; readonly by?: string } };

export interface InlineEditProps {
  readonly label: string;
  readonly value: string;
  /** How the value reads at rest, when not the raw string (a status pill, a person). */
  readonly display?: ReactNode;
  readonly editor?: 'text' | 'textarea' | 'select' | 'combobox' | 'date' | 'person';
  readonly options?: readonly InlineEditOption[];
  /** Client only: options for the `combobox` and `person` editors. */
  readonly loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly InlineEditOption[]>;
  /** Client only. Applied optimistically and rolled back on failure. */
  readonly onSave: (next: string) => Promise<InlineEditResult>;
  readonly validate?: (value: string) => string | null;
  /** Shown instead of the pencil when the person may not edit. */
  readonly readOnlyReason?: string;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * A value that becomes its own editor: a button at rest (with a pencil that is
 * always visible on touch screens), an editor on Enter or click, saved with
 * Enter and abandoned with Escape. A conflicting change is resolved in place.
 *
 * Stub (SPEC §4.4): renders the value at rest; the forms package implements
 * editing, saving, rollback and conflicts.
 */
export function InlineEdit({ label, value, display, placeholder, className }: InlineEditProps): ReactNode {
  return (
    <div className={cx('itsm-InlineEdit', className)}>
      <span>{label}</span> <span>{display ?? (value === '' ? placeholder : value)}</span>
    </div>
  );
}
