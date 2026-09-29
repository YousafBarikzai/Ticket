'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

/** A span of ISO calendar dates, both ends inclusive. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** A named shortcut ("Last 7 days"): one date for `DatePicker`, a range for `DateRangePicker`. */
export interface DatePreset {
  readonly label: string;
  readonly value: string | DateRange;
}

export interface DateRangePickerProps {
  readonly value: DateRange | null;
  readonly onChange: (value: DateRange | null) => void;
  readonly presets?: readonly DatePreset[];
  readonly className?: string;
}

/**
 * Two dates typed or picked on one calendar, with presets.
 *
 * Stub (SPEC §4.3): renders the range as text; the overlays package builds the
 * fields and the calendar popover.
 */
export function DateRangePicker({ value, className }: DateRangePickerProps): ReactNode {
  return <span className={cx('itsm-DateRangePicker', className)}>{value ? `${value.from} – ${value.to}` : ''}</span>;
}
