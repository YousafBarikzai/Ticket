'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SearchTriggerProps {
  readonly placeholder: string;
  readonly shortcut?: 'mod+k';
  /** Client only: opens the command palette. */
  readonly onOpen: () => void;
  readonly className?: string;
}

/**
 * Looks like a search field, is a button that opens the palette — honest
 * about what happens when it is pressed.
 *
 * Stub (SPEC §4.9): the button with its ARIA; the shell package adds the icon,
 * key cap and styling.
 */
export function SearchTrigger({ placeholder, onOpen, className }: SearchTriggerProps): ReactNode {
  return (
    <button
      type="button"
      className={cx('itsm-SearchTrigger', className)}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={onOpen}
    >
      {placeholder}
    </button>
  );
}
