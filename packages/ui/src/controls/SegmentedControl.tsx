'use client';

import type { ReactNode } from 'react';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';

export interface SegmentedOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** Required in `nav` mode: each segment is a link. */
  readonly href?: string;
  readonly count?: number;
}

export interface SegmentedControlProps {
  /** The group's accessible name. */
  readonly label: string;
  readonly options: readonly SegmentedOption[];
  readonly value: string;
  /**
   * `value`: a radio group that selects as focus moves, for local view state
   * (Reply / Internal note). `nav`: links with `aria-current`, for URL scopes
   * (Open / Needs you / All). `commit`: a radio group where arrows move focus
   * and Space or Enter commits, for persisted settings (X-61).
   */
  readonly mode: 'value' | 'nav' | 'commit';
  /** Client only; `value` and `commit` modes. */
  readonly onValueChange?: (value: string) => void;
  readonly size?: 'sm' | 'md';
  readonly fullWidth?: boolean;
  readonly className?: string;
}

/**
 * A row of mutually exclusive segments on a sliding thumb.
 *
 * Stub (SPEC §4.2): renders the option labels; the actions-and-inputs package
 * implements the three modes, keyboard and thumb.
 */
export function SegmentedControl({ options, value, mode, size = 'md', className }: SegmentedControlProps): ReactNode {
  return (
    <div className={cx('itsm-SegmentedControl', className)} data-mode={mode} data-size={size}>
      {options.map((option) => (
        <span key={option.value} data-selected={option.value === value || undefined}>
          {option.label}
        </span>
      ))}
    </div>
  );
}
