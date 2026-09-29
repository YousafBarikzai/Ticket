import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface ProgressBarProps {
  /** 0..1; absent for indeterminate. */
  readonly value?: number;
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** `sm` is the 2 px refetch line (indeterminate, label hidden). */
  readonly size?: 'sm' | 'md';
  readonly showValue?: boolean;
  readonly className?: string;
}

/**
 * Progress of a known or unknown length. Server-safe.
 *
 * Stub (SPEC §4.5): renders the `progressbar` with its value; the feedback
 * package draws it.
 */
export function ProgressBar({ value, label, tone = 'accent', size = 'md', className }: ProgressBarProps): ReactNode {
  const percent = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={percent === undefined ? undefined : 0}
      aria-valuemax={percent === undefined ? undefined : 100}
      aria-valuenow={percent}
      className={cx('itsm-ProgressBar', className)}
      data-tone={tone}
      data-size={size}
    />
  );
}
