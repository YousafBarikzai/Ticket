'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectOptionGroup {
  readonly label: string;
  readonly options: readonly SelectOption[];
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  readonly options: readonly (SelectOption | SelectOptionGroup)[];
  /** Rendered as a disabled first option, so an unanswered required field stays obvious. */
  readonly placeholder?: string;
}

function isGroup(option: SelectOption | SelectOptionGroup): option is SelectOptionGroup {
  return 'options' in option;
}

/**
 * A native `select`.
 *
 * Deliberately not a custom listbox: the native control gets the platform's own
 * keyboard handling, type-ahead, screen-reader behaviour and — on mobile — the
 * system picker, which no re-implementation matches. Where the product needs
 * search, multiple selection or asynchronous options, that is a `Combobox`, and
 * the difference is a real one rather than a styling preference.
 */
export function Select({ options, placeholder, className, defaultValue, value, ...rest }: SelectProps): ReactNode {
  return (
    <select {...rest} value={value} defaultValue={defaultValue} className={cx('itsm-Select', className)}>
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) =>
        isGroup(option) ? (
          <optgroup key={option.label} label={option.label}>
            {option.options.map((child) => (
              <option key={child.value} value={child.value} disabled={child.disabled}>
                {child.label}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ),
      )}
    </select>
  );
}
