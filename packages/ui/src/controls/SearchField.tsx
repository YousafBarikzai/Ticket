'use client';

import type { ReactNode } from 'react';
import type { Size } from '../types.js';
import { cx } from '../web/cx.js';

export interface SearchFieldProps {
  readonly value: string;
  /** Client only. Debounced by `debounceMs`. */
  readonly onValueChange: (value: string) => void;
  /** 200 ms for type-ahead everywhere; 300 for the portal's knowledge suggestions. */
  readonly debounceMs?: number;
  readonly onSubmit?: (value: string) => void;
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly placeholder?: string;
  /** Shown as a key cap while the field is empty, and bound as a hotkey (`/`). */
  readonly shortcut?: string;
  readonly loading?: boolean;
  readonly size?: Size;
  /** Default true: a "Clear search" button once there is text. */
  readonly clearable?: boolean;
  readonly className?: string;
}

/**
 * A search landmark: `<search>` wrapping an `input type=search` with a leading
 * icon, a trailing clear button and a spinner while results load.
 *
 * Stub (SPEC §4.2): renders a labelled, uncontrolled-looking search input
 * that reports keystrokes undebounced; the actions-and-inputs package
 * implements the rest.
 */
export function SearchField({ value, onValueChange, label, placeholder, size = 'md', className }: SearchFieldProps): ReactNode {
  return (
    <div role="search" className={cx('itsm-SearchField', className)} data-size={size}>
      <input
        type="search"
        enterKeyHint="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
    </div>
  );
}
