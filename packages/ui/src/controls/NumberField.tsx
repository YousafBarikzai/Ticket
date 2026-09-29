'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface NumberFieldProps {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Shown after the value, e.g. "%" or "tickets". */
  readonly unit?: string;
  /** When not inside a `FormField`, which otherwise names it. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * A number input with labelled − and + buttons in place of the browser's
 * spinners, which are too small to hit and invisible to most people.
 *
 * Stub (SPEC §4.2): a plain number input; the actions-and-inputs package adds
 * the steppers, clamping and `FormField` wiring.
 */
export function NumberField({ value, onChange, min, max, step, label, className }: NumberFieldProps): ReactNode {
  return (
    <input
      type="number"
      className={cx('itsm-NumberField', className)}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value ?? ''}
      onChange={(event) => {
        const text = event.currentTarget.value;
        onChange(text === '' || Number.isNaN(Number(text)) ? null : Number(text));
      }}
    />
  );
}
