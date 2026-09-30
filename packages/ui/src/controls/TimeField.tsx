'use client';

import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import type { Size } from '../types.js';
import { cx } from '../web/cx.js';
import { Input } from '../web/Input.js';

export interface TimeFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'prefix' | 'step' | 'min' | 'max' | 'children'
  > {
  /** `HH:mm`, or null when empty. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /** Minutes between allowed times. */
  readonly step?: number;
  /** Earliest and latest allowed, `HH:mm`. */
  readonly min?: string;
  readonly max?: string;
  readonly size?: Size;
  /** When not inside a `FormField`, which otherwise names it. */
  readonly label?: string;
  readonly invalid?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
  readonly className?: string;
}

/** `HH:mm` from what a time input reports, which may carry seconds. */
function toHoursMinutes(text: string): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(text);
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * A time of day, for business hours and shift patterns.
 *
 * The native time input, in the shared field box: the platform draws the
 * hours and minutes in the person's own 12- or 24-hour convention, steps them
 * with the arrow keys, and offers its own picker on phones — none of which a
 * text box with a pattern would. The value is always `HH:mm`, whatever the
 * display. Sized to its content rather than the full width, in tabular
 * figures.
 */
export function TimeField({ value, onChange, step, min, max, size = 'md', label, invalid, className, ref, ...rest }: TimeFieldProps): ReactNode {
  return (
    <Input
      {...rest}
      ref={ref}
      type="time"
      size={size}
      invalid={invalid}
      {...(label && !rest['aria-label'] ? { 'aria-label': label } : {})}
      className={cx('itsm-TimeField', className)}
      step={step === undefined ? undefined : step * 60}
      min={min}
      max={max}
      value={value ?? ''}
      onChange={(event) => onChange(event.currentTarget.value === '' ? null : toHoursMinutes(event.currentTarget.value))}
    />
  );
}
