'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface TimeFieldProps {
  /** `HH:mm`, or null when empty. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /** Minutes between allowed times. */
  readonly step?: number;
  readonly className?: string;
}

/**
 * A time of day, for business hours and shift patterns.
 *
 * Stub (SPEC §4.2): the native time input; the actions-and-inputs package
 * restyles it and wires `FormField`.
 */
export function TimeField({ value, onChange, step, className }: TimeFieldProps): ReactNode {
  return (
    <input
      type="time"
      className={cx('itsm-TimeField', className)}
      step={step === undefined ? undefined : step * 60}
      value={value ?? ''}
      onChange={(event) => onChange(event.currentTarget.value === '' ? null : event.currentTarget.value)}
    />
  );
}
