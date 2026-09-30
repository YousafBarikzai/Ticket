'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import type { Size } from '../types.js';
import { cx } from './cx.js';
import { mergeFieldProps, useFieldControl } from './FormField.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectOptionGroup {
  readonly label: string;
  readonly options: readonly SelectOption[];
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children' | 'size'> {
  readonly options: readonly (SelectOption | SelectOptionGroup)[];
  /** Rendered as a disabled first option, so an unanswered required field stays obvious. */
  readonly placeholder?: string;
  readonly size?: Size;
  /** Marks the select invalid when it is not inside a `FormField` with an `error`. */
  readonly invalid?: boolean;
}

function isGroup(option: SelectOption | SelectOptionGroup): option is SelectOptionGroup {
  return 'options' in option;
}

/**
 * A native `select`, drawn like the other fields.
 *
 * Deliberately not a custom listbox: the native control gets the platform's own
 * keyboard handling, type-ahead, screen-reader behaviour and — on mobile — the
 * system picker, which no re-implementation matches. Where the product needs
 * search, multiple selection or asynchronous options, that is a `Combobox`, and
 * the difference is a real one rather than a styling preference.
 *
 * The browser's arrow is replaced by the registry's chevron (`appearance:
 * none`), which the platform's own arrow returns under forced colours, where
 * a drawn one could vanish. A placeholder that is showing reads in the muted
 * text colour, like an empty text field's.
 */
export function Select({ options, placeholder, size = 'md', invalid, className, defaultValue, value, ...rest }: SelectProps): ReactNode {
  const field = useFieldControl();
  const props = mergeFieldProps(field, { ...rest, ...(invalid ? { 'aria-invalid': true as const } : {}) });
  // Uncontrolled with a placeholder: start on the placeholder, not on the
  // first real option, or an unanswered question looks answered.
  const initial = defaultValue ?? (value === undefined && placeholder && !rest.multiple ? '' : undefined);

  return (
    <span className={cx('itsm-SelectField', size !== 'md' && `itsm-SelectField--${size}`)} data-multiple={rest.multiple ? '' : undefined}>
      <select
        {...props}
        value={value}
        defaultValue={initial}
        className={cx('itsm-Select', size !== 'md' && `itsm-Select--${size}`, className)}
      >
        {placeholder ? (
          <option value="" disabled data-placeholder="">
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
      {rest.multiple ? null : <Icon name="chevron-down" size="sm" className="itsm-SelectField__chevron" />}
    </span>
  );
}
