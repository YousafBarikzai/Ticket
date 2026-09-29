'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface FilterChipProps {
  readonly label: string;
  /** The current choice in words: "Open, Paused". */
  readonly valueLabel?: string;
  readonly active: boolean;
  /** Client only. The chip's ×. */
  readonly onClear?: () => void;
  /** The popover content: a checkbox list, a date range. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * "Status: Open, Paused ×" — a filter as a chip that opens its own options.
 *
 * Stub (SPEC §4.7): renders the chip's text; the data package adds the
 * popover and the clear button.
 */
export function FilterChip({ label, valueLabel, active, className }: FilterChipProps): ReactNode {
  return (
    <span className={cx('itsm-FilterChip', className)} data-active={active || undefined}>
      {valueLabel ? `${label}: ${valueLabel}` : label}
    </span>
  );
}
