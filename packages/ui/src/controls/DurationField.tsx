'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface DurationFieldProps {
  /** Minutes, or null when empty. */
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly units?: readonly ('m' | 'h' | 'd')[];
  /** Says the duration is counted in business hours, not wall-clock time. */
  readonly businessTime?: boolean;
  /** Default 1: a zero-minute target is a mistake, said inline rather than saved. */
  readonly min?: number;
  /** Default 525600 (a year). */
  readonly max?: number;
  readonly className?: string;
}

/**
 * A duration typed the way people say it — "4h", "1d 2h", "90" — shown back
 * normalised ("4 h"). Replaces the admin `DurationInput` and its
 * `Number(x) || 60` fallback, which turned a typo into an hour.
 *
 * Stub (SPEC §4.2): a text input showing the minutes; the actions-and-inputs
 * package implements parsing, the chip and validation.
 */
export function DurationField({ value, businessTime = false, className }: DurationFieldProps): ReactNode {
  return (
    <input
      type="text"
      inputMode="text"
      className={cx('itsm-DurationField', className)}
      data-business-time={businessTime || undefined}
      defaultValue={value === null ? '' : String(value)}
    />
  );
}
