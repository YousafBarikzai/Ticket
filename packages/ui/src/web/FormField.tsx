'use client';

import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { joinIds, useIds } from '../a11y/ids.js';

export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-required': true | undefined;
  readonly required: boolean;
}

export interface FormFieldProps {
  readonly label: ReactNode;
  /**
   * A render prop rather than `cloneElement`: the control receives its wiring
   * explicitly, so a custom control (Combobox, DatePicker, a third-party
   * editor) can be dropped in without the field guessing at its props.
   */
  readonly children: (control: FieldControlProps) => ReactNode;
  readonly hint?: ReactNode;
  /** A string, not a boolean: "this is wrong" without saying why fails SC 3.3.3. */
  readonly error?: string;
  readonly required?: boolean;
  /** Hides the label visually but keeps it for assistive technology and for voice control. */
  readonly labelHidden?: boolean;
  readonly className?: string;
}

export function FormField({ label, children, hint, error, required = false, labelHidden = false, className }: FormFieldProps): ReactNode {
  const ids = useIds('itsm-field', ['control', 'hint', 'error'] as const);

  return (
    <div className={cx('itsm-Field', className)}>
      <label className={cx('itsm-Field__label', labelHidden && 'itsm-visually-hidden')} htmlFor={ids.control}>
        {label}
        {required ? (
          <span className="itsm-Field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <span className="itsm-Field__hint" id={ids.hint}>
          {hint}
        </span>
      ) : null}
      {children({
        id: ids.control,
        // The hint comes first: a screen reader reads the description in order,
        // and the error is the more recent, more urgent half.
        'aria-describedby': joinIds(hint && ids.hint, error && ids.error),
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
        required,
      })}
      {error ? (
        // Not role="alert": the error is already referenced by the control, and
        // an alert would interrupt the user mid-keystroke on every re-render.
        <span className="itsm-Field__error" id={ids.error}>
          <span aria-hidden="true">⚠</span>
          {error}
        </span>
      ) : null}
    </div>
  );
}
