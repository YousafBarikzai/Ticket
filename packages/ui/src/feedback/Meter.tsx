import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface MeterProps {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  /** Values at or above which the meter turns warning, then danger. */
  readonly thresholds?: { readonly warning: number; readonly danger: number };
  /** A marked point before the limit (a soft quota). */
  readonly softLine?: number;
  /** The limit itself. */
  readonly hardLine?: number;
  readonly format?: Intl.NumberFormatOptions;
  readonly className?: string;
}

/**
 * A measurement within a known range — plan usage, AI budget. `role="meter"`,
 * with the value also written out, because a bar alone is read by nobody who
 * cannot see it. Server-safe.
 *
 * Stub (SPEC §4.5): renders the meter and its value as text; the feedback
 * package draws it with thresholds and lines.
 */
export function Meter({ value, max, label, className }: MeterProps): ReactNode {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx('itsm-Meter', className)}
    >
      {`${value} / ${max}`}
    </div>
  );
}
