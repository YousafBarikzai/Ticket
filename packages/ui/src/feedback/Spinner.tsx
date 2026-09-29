import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SpinnerProps {
  readonly size?: 'sm' | 'md' | 'lg';
  /** Makes it a `status` with this name. Without it the spinner is decoration beside text that says what is happening. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Indeterminate activity. Server-safe. Pulses instead of rotating under
 * reduced motion.
 *
 * Stub (SPEC §4.5): renders the element and its role; the feedback package
 * draws it.
 */
export function Spinner({ size = 'md', label, className }: SpinnerProps): ReactNode {
  return label ? (
    <span role="status" className={cx('itsm-Spinner', className)} data-size={size}>
      <span className="itsm-visually-hidden">{label}</span>
    </span>
  ) : (
    <span aria-hidden="true" className={cx('itsm-Spinner', className)} data-size={size} />
  );
}
